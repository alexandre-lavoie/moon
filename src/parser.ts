import * as moonJSON from "./lang/moon.json";
import { ADDRESS_SIZE, MoonOp, opFromString } from "./op";
import { AST, ASTNode, BranchNode, DerivationEnter, DerivationEntry, DerivationExit, DerivationToken, FA, Grammar, GrammarEnd, GrammarSymbol, GrammarTerminal, ParseTable, Token, TokenNode, Visitor, VisitorData } from "./utils";

export class MoonParser {
    private fa: FA;
    private grammar: Grammar;

    constructor() {
        this.fromSlng();
    }

    private fromSlng() {
        this.fa = FA.deserialize(moonJSON.l);
        this.grammar = Grammar.deserialize(moonJSON.p);
    }

    private tokenizeNext(source: string, offset: number): [Token | null, number] {
        let nodeIndex = 0;
        let lastIndex: number | null = null;
        let lexeme: string = "";

        let i = offset;
        while(true) {
            let node = this.fa.getNode(nodeIndex);

            if(node.isTerminal()) {
                if(node.isLazy()) {
                    let token = null;
                    if(!node.isSkip()) token = new Token(lexeme, node.getTerminal(), offset);
                    return [token, i];
                }

                lastIndex = nodeIndex;
            }

            let symbol = source.charCodeAt(i);
            let nextNode = this.fa.next(nodeIndex, symbol);

            if(nextNode === null) {
                if(lastIndex === null) {
                    throw new Error(`Tokenizing failed at ${i}`);
                } else {
                    node = this.fa.getNode(lastIndex);

                    let token = null;
                    if(!node.isSkip()) token = new Token(lexeme, node.getTerminal(), offset);
                    return [token, i];
                }
            } else {
                nodeIndex = nextNode;
                lexeme += source.charAt(i);
                i += 1;
            }
        }
    }

    private tokenize(source: string): Token[] {
        let tokens: Token[] = [];

        let i = 0;
        while(i < source.length) {
            let [token, next] = this.tokenizeNext(source, i);
            if(token !== null) tokens.push(token);
            i = next;
        }

        return tokens;
    }

    private parseDerivation(tokens: Token[]): DerivationEntry[] {
        let derivation: DerivationEntry[] = [];

        let parseTable = ParseTable.fromGrammar(this.grammar);

        let token = 0;
        let stack: (number | string)[] = [this.grammar.getStartIndex(), this.grammar.getEndIndex()];
        while(stack.length > 0) {
            let atomIndex = stack.shift();

            if(typeof atomIndex === "string") {
                derivation.push(new DerivationExit(atomIndex));
                continue;
            }

            let tokenIndex;
            if(token < tokens.length) tokenIndex = this.grammar.getTokenIndex(tokens[token]);
            else tokenIndex = this.grammar.getEndIndex();

            let atom = this.grammar.getAtom(atomIndex);

            if(atom instanceof GrammarSymbol) {
                derivation.push(new DerivationEnter(atom.getSymbol()));
                let rule = parseTable.next(atomIndex, tokenIndex);
                if(rule == null) throw new Error(`Parsing symbol ${atom} and ${tokens[token]} failed`);
                stack = [...rule, atom.getSymbol(), ...stack];
            } else if(atom instanceof GrammarEnd) {
                if(tokenIndex != atomIndex) throw new Error("Parsing end failed");
            } else if(atom instanceof GrammarTerminal) {
                derivation.push(new DerivationToken(tokens[token]));
                if(tokenIndex != atomIndex) throw new Error(`Parsing ${atom} failed`);
                token += 1;
            }
        }

        return derivation;
    }

    private treeify(tokens: Token[]): AST {
        let nodes: ASTNode[] = [new BranchNode("START")];
        let edges: {[key: number]: number[]} = {};

        let derivation = this.parseDerivation(tokens);

        let scopes: {[key: number]: number[]}[] = [{[-1]: []}];
        let scopeTokens: Token[] = [];
        for(let entry of derivation) {
            if(entry instanceof DerivationEnter) {
                if(!entry.getSymbol().includes("_")) {
                    scopes.push({[-1]: []});
                    scopeTokens = [];
                }
            } else if (entry instanceof DerivationToken) {
                scopeTokens.push(entry.getToken());
            } else if(entry instanceof DerivationExit) {
                let currentScope = scopes[scopes.length - 1];

                if(!entry.getSymbol().includes("_")) {
                    scopes.pop();

                    if(Object.keys(currentScope).length === 1) {
                        scopes[scopes.length - 1][-1] = [...scopes[scopes.length - 1][-1], ...currentScope[-1]]
                    } else {
                        let parentIndex = nodes.length;
                        scopes[scopes.length - 1][-1] = [...scopes[scopes.length - 1][-1], parentIndex];
                        nodes.push(new BranchNode(entry.getSymbol()));
                        edges[parentIndex] = [];
    
                        for(let [branchName, children] of Object.entries(currentScope)) {
                            if(parseInt(branchName) === -1) continue;
    
                            let branchIndex = nodes.length;
                            nodes.push(new BranchNode(branchName));
                            edges[branchIndex] = children;
    
                            edges[parentIndex].push(branchIndex);
                        }
                    }

                    scopeTokens = [];
                } else if(entry.getSymbol().endsWith("_r")) {
                    for(let token of scopeTokens) {
                        currentScope[-1].push(nodes.length);
                        nodes.push(new TokenNode(token));
                    }
                    scopeTokens = [];
                } else if(entry.getSymbol().includes("_s")) {
                    let symbolSplit = entry.getSymbol().split("_s");
                    let index = parseInt(symbolSplit[symbolSplit.length - 1]);

                    if(currentScope[index] === undefined) {
                        currentScope[index] = currentScope[-1];
                    } else {
                        currentScope[index] = [...currentScope[index], ...currentScope[-1]];
                    }

                    currentScope[-1] = [];
                }
            }
        }

        edges[0] = scopes[0][-1];

        return new AST(nodes, edges);
    }

    public parse(source: string): MoonData {
        let tokens = this.tokenize(source);
        let ast = this.treeify(tokens);
        let symbols = new MoonType().visit(ast).getData();
        let data = new MoonGenerator(symbols).visit(ast).getData();

        return data;
    }
}

class MoonSymbol extends VisitorData {
    public symbols: {[key: string]: number};

    constructor() {
        super();
        this.symbols = {};
    }

    protected mergeOne<T extends this>(other: T): void {
        let otherSet = new Set(Object.keys(other.symbols));
        let intersect = [...Object.keys(this.symbols)].filter(symbol => otherSet.has(symbol));

        if(intersect.length > 0) throw new Error(`Duplicate symbols ${intersect}`);

        this.symbols = {...this.symbols, ...other.symbols};
    }
}

class MoonType extends Visitor<MoonSymbol> {
    private offset: number;

    protected enter(ast: AST): void {
        this.offset = 0;
    }

    protected elseExit(ast: AST, index: number, tree: { [key: number]: MoonSymbol; }): MoonSymbol {
        let node = ast.node(index);

        if(node instanceof BranchNode) {
            if(node.getSymbol().startsWith("Instr")) {
                let op = opFromString(ast.lexeme(ast.child(index, 0)));

                switch(op) {
                    case MoonOp.bad:
                    case MoonOp.db:
                    case MoonOp.dw:
                    case MoonOp.org:
                    case MoonOp.entry:
                    case MoonOp.res:
                    case MoonOp.align:
                        // TODO
                        break;
                    default:
                        this.offset += ADDRESS_SIZE;
                }
            }
        }

        return new MoonSymbol().merge(tree);
    }

    protected elseToken(token: Token): MoonSymbol {
        return new MoonSymbol();
    }

    protected exitSymbol(ast: AST, index: number, tree: { [key: number]: MoonSymbol; }): MoonSymbol {
        let data = new MoonSymbol().merge(tree);

        let symbol = ast.lexeme(ast.child(index, 0));

        data.symbols[symbol] = this.offset;

        return data;
    }
}

export class MoonData extends VisitorData {
    public entry?: number;
    public registers: number[];
    public instructions: [number, number][];
    public constants: number[];

    public static offset: number = 0;

    constructor() {
        super();
        this.entry = null;
        this.registers = [];
        this.instructions = [];
        this.constants = [];
    }

    public popRegisters(): number[] {
        let registers = this.registers;
        this.registers = [];
        return registers;
    }

    public popConstants(): number[] {
        let constants = this.constants;
        this.constants = [];
        return constants;
    }

    public pushInstrA(op: MoonOp, ri: number, rj: number, rk: number) {
        let instr = (op as number) << 26 | ri << 22 | rj << 18 | rk << 14;
        this.instructions.push([MoonData.offset, instr]);
        MoonData.offset += ADDRESS_SIZE;
    }

    public pushInstrB(op: MoonOp, ri: number, rj: number, k: number) {
        let instr = (op as number) << 26 | ri << 22 | rj << 18 | k & 0xFFFF;
        this.instructions.push([MoonData.offset, instr]);
        MoonData.offset += ADDRESS_SIZE;
    }

    protected mergeOne<T extends this>(other: T) {
        if(this.entry === null) this.entry = other.entry;
        this.registers = [...this.registers, ...other.registers];
        this.instructions = [...this.instructions, ...other.instructions];
        this.constants = [...this.constants, ...other.constants];
    }
}

class MoonGenerator extends Visitor<MoonData> {
    private symbols: MoonSymbol;

    constructor(symbols: MoonSymbol) {
        super();
        this.symbols = symbols;
    }

    protected enter(ast: AST): void {
        MoonData.offset = 0;
    }

    protected elseExit(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        return new MoonData().merge(tree);
    }

    protected elseToken(token: Token): MoonData {
        return new MoonData();
    }

    protected exitRegister(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let register = parseInt(ast.lexeme(ast.child(index, 0)).substring(1));
        data.registers.push(register);

        return data;
    }

    protected exitReference(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let symbol = ast.lexeme(ast.child(index, 0));
        let offset = this.symbols.symbols[symbol];
        data.constants.push(offset);

        return data;
    }

    protected exitNumber(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let number = parseInt(ast.lexeme(ast.child(index, 0)));
        data.constants.push(number);

        return data;
    }

    protected exitInstrZ(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        switch(op) {
            case MoonOp.entry:
                data.entry = MoonData.offset;
                break;
            case MoonOp.align:
                if(MoonData.offset % 4 != 0) MoonData.offset += 4 - MoonData.offset % 4;
                break;
            case MoonOp.nop:
            case MoonOp.hlt:
                data.pushInstrA(op, 0, 0, 0);
                break;
        }

        return data;
    }

    protected exitInstrR(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri] = data.popRegisters();

        data.pushInstrA(op, ri, 0, 0);

        return data;
    }

    protected exitInstrRO(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri] = data.popRegisters();
        let [o] = data.popConstants();

        data.pushInstrB(op, ri, 0, o);

        return data;
    }

    protected exitInstrRC(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri] = data.popRegisters();
        let [k] = data.popConstants();

        data.pushInstrB(op, ri, 0, k);

        return data;
    }

    protected exitInstrRw(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri, rj] = data.popRegisters();

        data.pushInstrA(op, ri, rj, 0);

        return data;
    }

    protected exitInstrRwC(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri, rj] = data.popRegisters();
        let [k] = data.popConstants();

        data.pushInstrB(op, ri, rj, k);

        return data;
    }

    protected exitInstrRh(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri, rj, rk] = data.popRegisters();

        data.pushInstrA(op, ri, rj, rk);

        return data;
    }

    protected InstrOR(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [ri] = data.popRegisters();
        let [o] = data.popConstants();

        data.pushInstrB(op, ri, 0, o);

        return data;
    }

    protected InstrC(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [k] = data.popConstants();

        switch(op) {
            case MoonOp.org:
                MoonData.offset = k;
                break;
            case MoonOp.res:
                MoonData.offset += k;
                break;
            case MoonOp.j:
                data.pushInstrB(op, 0, 0, k);
                break;
        }

        return data;
    }

    protected InstrCm(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        // TODO
        let op = opFromString(ast.lexeme(ast.child(index, 0)));

        switch(op) {
            case MoonOp.dw:
                break;
            case MoonOp.db:
                break;
        }

        return data;
    }
}
