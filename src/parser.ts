import Config from "./config";
import { instrAToWord, instrBToWord, MoonOp, opFromString } from "./op";
import { AST, ASTNode, BranchNode, ByteStream, DerivationEnter, DerivationEntry, DerivationExit, DerivationToken, FA, FANode, FASymbol, GrammarAtom, GrammarEnd, GrammarEpsilon, GrammarSymbol, GrammarTerminal, ParseTable, Token, TokenNode, Visitor, VisitorData } from "./utils";

import * as moonClng from "./lang/moon.clng";
export class MoonParser {
    private fa: FA;
    private atoms: GrammarAtom[];
    private terminalAtomIndices: {[key: string]: number};
    private startIndex: number;
    private endIndex: number;
    private parseTable: ParseTable;
    private config: Config;

    constructor(config: Config) {
        this.fromClng();
        this.config = config;
    }

    private fromClng() {
        let dataUri = moonClng as any as string;
        let base64 = dataUri.split(";base64,")[1];
        let source = new Uint8Array(Buffer.from(base64, "base64"));
        let s = new ByteStream(source);

        if(s.str(4) !== "CLNG") throw new Error("Not a CLNG file");

        let nodes = s.list(s => [s.u8(), s.u16()]);
        let edges = s.dict(s => s.u16(), s => s.dict(s => s.u16(), s => s.list(s => [s.u8(), s.u8()])));
        let symbolRules = s.dict(s => s.u16(), s => s.dict(s => s.u16(), s => s.list(s => s.u16())));
        let terminals = s.list(s => s.str());
        let symbols = s.list(s => s.str());

        let faNodes: FANode[] = nodes.map(([flags, terminalIndex]) => {
            let skip = (flags & 0b1) > 0;
            let lazy = (flags & 0b10) > 0;

            let terminal = null;
            if(terminalIndex > 0) terminal = terminals[terminalIndex];

            return new FANode(lazy, skip, terminal);
        });

        let faEdges: {[key: number]: {[key: number]: FASymbol[]}} = {};
        edges.forEach((edges, inNode) => {
            let out: {[key: number]: FASymbol[]} = {};
            edges.forEach((edges, outNode) => {
                let ranges: FASymbol[] = [];
                edges.forEach(([l, r]) => {
                    ranges.push(new FASymbol(l, r));
                });
                out[outNode] = ranges;
            });
            faEdges[inNode] = out;
        });

        this.fa = new FA(faNodes, faEdges);

        let atoms: GrammarAtom[] = [];
        let terminalAtoms: {[key: string]: number} = {};
        for(let terminal of terminals) {
            if(terminal === "") atoms.push(new GrammarEpsilon());
            else {
                terminalAtoms[terminal] = atoms.length;
                atoms.push(new GrammarTerminal(terminal));
            }
        }
        for(let symbol of symbols) {
            if(symbol === "START") this.startIndex = atoms.length;
            else if(symbol === "$") this.endIndex = atoms.length;

            if(symbol === "$") atoms.push(new GrammarEnd());
            else atoms.push(new GrammarSymbol(symbol));
        }
        this.atoms = atoms;
        this.terminalAtomIndices = terminalAtoms;

        this.parseTable = new ParseTable(symbolRules);
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

        let token = 0;
        let stack: (number | string)[] = [this.startIndex, this.endIndex];
        while(stack.length > 0) {
            let atomIndex = stack.shift();

            if(typeof atomIndex === "string") {
                derivation.push(new DerivationExit(atomIndex));
                continue;
            }

            let tokenIndex;
            if(token < tokens.length) tokenIndex = this.terminalAtomIndices[tokens[token].getType()];
            else tokenIndex = this.endIndex;

            let atom = this.atoms[atomIndex];

            if(atom instanceof GrammarSymbol) {
                derivation.push(new DerivationEnter(atom.getSymbol()));
                let rule = this.parseTable.next(atomIndex, tokenIndex);
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
        let symbols = new MoonType(this.config).visit(ast).getData();
        let data = new MoonGenerator(this.config, symbols).visit(ast).getData();

        return data;
    }
}

class MoonSymbol extends VisitorData {
    public symbols: {[key: string]: number};

    constructor() {
        super();
        this.symbols = {};
    }

    public getSymbols(address: number): string[] {
        return Object.entries(this.symbols).filter(([_, symbolAddress]) => symbolAddress === address).map(([symbol]) => symbol);
    }

    protected mergeOne<T extends this>(other: T): void {
        let otherSet = new Set(Object.keys(other.symbols));
        let intersect = [...Object.keys(this.symbols)].filter(symbol => otherSet.has(symbol));

        if(intersect.length > 0) {
            throw new Error(`Duplicate symbols ${intersect}`);
        }

        this.symbols = {...this.symbols, ...other.symbols};
    }
}

class MoonType extends Visitor<MoonSymbol> {
    private config: Config;
    private offset: number;
    private scope?: MoonOp;

    constructor(config: Config) {
        super();
        this.config = config;
    }

    protected enter(ast: AST): void {
        this.offset = 0;
        this.scope = null;
    }

    protected exit(data: MoonSymbol): void {
        data.symbols["topaddr"] = this.config.topAddress;
    }

    protected elseList(ast: AST, list: MoonSymbol[]): MoonSymbol {
        return new MoonSymbol().mergeList(list);
    }

    protected elseEnter(ast: AST, index: number) {
        let node = ast.node(index);

        if(node instanceof BranchNode && node.getSymbol().startsWith("Instr")) {
            this.scope = opFromString(ast.lexeme(ast.child(index, 0)));
        }
    }

    protected elseExit(ast: AST, index: number, tree: { [key: number]: MoonSymbol; }): MoonSymbol {
        let node = ast.node(index);

        if(node instanceof BranchNode && node.getSymbol().startsWith("Instr")) {
            let op = opFromString(ast.lexeme(ast.child(index, 0)));

            switch(op) {
                case MoonOp.bad:
                case MoonOp.db:
                case MoonOp.dw:
                case MoonOp.org:
                case MoonOp.res:
                    break;
                case MoonOp.align:
                    if(this.offset % this.config.addressSize != 0) this.offset += this.config.addressSize - this.offset % this.config.addressSize;
                    break;
                case MoonOp.entry:
                    break;
                default:
                    this.offset += this.config.addressSize;
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

    protected exitString(ast: AST, index: number, tree: { [key: number]: MoonSymbol; }): MoonSymbol {
        let string = ast.lexeme(ast.child(index, 0)).slice(1, -1);

        switch(this.scope) {
            case MoonOp.db:
                this.offset += string.length;
                break;
            case MoonOp.dw:
                this.offset += string.length * this.config.addressSize;
                break;
        }

        return new MoonSymbol().merge(tree);
    }

    protected exitNumber(ast: AST, index: number, tree: { [key: number]: MoonSymbol; }): MoonSymbol {
        let number = parseInt(ast.lexeme(ast.child(index, 0)));

        switch(this.scope) {
            case MoonOp.db:
                this.offset += 1;
                break;
            case MoonOp.dw:
                this.offset += this.config.addressSize;
                break;
            case MoonOp.res:
                this.offset += number;
                break;
            case MoonOp.org:
                this.offset = number;
                break;
        }

        return new MoonSymbol().merge(tree);
    }
}

export class MoonData extends VisitorData {
    public entry?: number;
    public registers: number[];
    public bytes: [number, number][];
    public words: [number, number][];
    public constants: number[];
    public symbols?: MoonSymbol;
    public innerOffset: number;

    public static config: Config;
    private static staticOffset: number = 0;

    constructor() {
        super();
        this.entry = null;
        this.registers = [];
        this.bytes = [];
        this.words = [];
        this.constants = [];
        this.symbols = null;
        this.innerOffset = 0;
    }

    public static resetStaticOffset() {
        this.staticOffset = 0;
    }

    public static getStaticOffset() {
        return this.staticOffset;
    }

    public get offset(): number {
        return this.innerOffset;
    }

    public setOffset() {
        this.innerOffset = MoonData.staticOffset;
    }

    public static addStaticOffset(offset: number) {
        this.staticOffset += offset;
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

    private pushInstr(instr: number) {
        this.words.push([MoonData.staticOffset, instr]);
        MoonData.staticOffset += MoonData.config.addressSize;
    }

    public pushInstrA(op: MoonOp, ri: number, rj: number, rk: number) {
        this.pushInstr(instrAToWord(MoonData.config, op, ri, rj, rk));
    }

    public pushInstrB(op: MoonOp, ri: number, rj: number, k: number) {
        this.pushInstr(instrBToWord(MoonData.config, op, ri, rj, k));
    }

    protected mergeOne<T extends this>(other: T) {
        if(this.entry === null) this.entry = other.entry;
        this.registers = [...this.registers, ...other.registers];
        this.bytes = [...this.bytes, ...other.bytes];
        this.words = [...this.words, ...other.words];
        this.constants = [...this.constants, ...other.constants];
    }
}

class MoonGenerator extends Visitor<MoonData> {
    private config: Config;
    private symbols: MoonSymbol;

    constructor(config: Config, symbols: MoonSymbol) {
        super();
        this.config = config;
        this.symbols = symbols;
    }

    protected enter(ast: AST): void {
        MoonData.config = this.config;
        MoonData.resetStaticOffset();
    }

    protected exit(data: MoonData): void {
        data.symbols = this.symbols;
        data.setOffset();
    }

    protected elseExit(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        return new MoonData().merge(tree);
    }

    protected elseList(ast: AST, list: MoonData[]): MoonData {
        return new MoonData().mergeList(list);
    }

    protected elseToken(token: Token): MoonData {
        return new MoonData();
    }

    protected exitRegister(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let register = parseInt(ast.lexeme(index).substring(1));
        data.registers.push(register);

        return data;
    }

    protected exitReference(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let symbol = ast.lexeme(ast.child(index, 0));
        let offset = this.symbols.symbols[symbol];

        if(offset == null) {
            throw new Error(`No symbol ${symbol}.`);
        }

        data.constants.push(offset);

        return data;
    }

    protected exitString(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let string = ast.lexeme(ast.child(index, 0));
        for(let i = 1; i < string.length - 1; i++) {
            data.constants.push(string.charCodeAt(i));
        }

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
                data.entry = MoonData.getStaticOffset();
                break;
            case MoonOp.align:
                if(MoonData.getStaticOffset() % this.config.addressSize != 0) MoonData.addStaticOffset(this.config.addressSize - MoonData.getStaticOffset() % this.config.addressSize);
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
        let [ri, rj] = data.popRegisters();
        let [o] = data.popConstants();

        data.pushInstrB(op, ri, rj, o);

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

    protected exitInstrOR(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [rj, ri] = data.popRegisters();
        let [o] = data.popConstants();

        data.pushInstrB(op, ri, rj, o);

        return data;
    }

    protected exitInstrC(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let [k] = data.popConstants();

        switch(op) {
            case MoonOp.org:
                MoonData.addStaticOffset(k);
                break;
            case MoonOp.res:
                MoonData.addStaticOffset(k);
                break;
            case MoonOp.j:
                data.pushInstrB(op, 0, 0, k);
                break;
        }

        return data;
    }

    protected exitInstrCm(ast: AST, index: number, tree: { [key: number]: MoonData; }): MoonData {
        let data = new MoonData().merge(tree);

        let op = opFromString(ast.lexeme(ast.child(index, 0)));
        let constants = data.popConstants();

        switch(op) {
            case MoonOp.dw:
                for(let c of constants) {
                    data.words.push([MoonData.getStaticOffset(), c]);
                    MoonData.addStaticOffset(this.config.addressSize);
                }
                break;
            case MoonOp.db:
                for(let c of constants) {
                    data.bytes.push([MoonData.getStaticOffset(), c]);
                    MoonData.addStaticOffset(1);
                }
                break;
        }

        return data;
    }
}
