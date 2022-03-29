export class Token {
    private lexeme: string;
    private type: string;
    private location: number;

    constructor(lexeme: string, type: string, location: number) {
        this.lexeme = lexeme;
        this.type = type;
        this.location = location;
    }

    public toString(): string {
        return `Token(lexeme=${this.lexeme}, type=${this.type}, location=${this.location})`;
    }

    public getLexeme(): string {
        return this.lexeme;
    }

    public getType(): string {
        return this.type;
    }

    public toDot(): string {
        return `${this.type} | ${this.lexeme}`;
    }
}

export class FA {
    private nodes: FANode[];
    private edges: {[key: number]: {[key: number]: FASymbol[]}};

    constructor(nodes: FANode[], edges: {[key: number]: {[key: number]: FASymbol[]}}) {
        this.nodes = nodes;
        this.edges = edges;
    }

    public static deserialize(json: any): FA {
        let faTerminals: string[] = json.f;
        let faMaxNode = Object.keys(json.g).reduce((previous, index) => Math.max(parseInt(index), previous), 0);

        let faNodes: FANode[] = [];
        let faEdges: {[key: number]: {[key: number]: FASymbol[]}} = {};
        for(let i = 0; i <= faMaxNode; i++) {
            let node: {l?: boolean, s?: boolean, f?: number, e?: {[key: string]: (Array<number> | number)[]}} = (json.g as any)[`${i}`];

            let lazy = node.hasOwnProperty("l");
            let skip = node.hasOwnProperty("s");

            let terminal: string = null;
            if(node.hasOwnProperty("f")) {
                terminal = faTerminals[node["f"]];
            }

            faNodes.push(new FANode(lazy, skip, terminal));

            let edges: {[key: number]: FASymbol[]} = {};
            if(node.hasOwnProperty("e")) {
                for(let [child, symbols] of Object.entries(node.e)) {
                    edges[parseInt(child)] = symbols.map(symbol => {
                        if(symbol instanceof Array) {
                            return new FASymbol(symbol[0], symbol[1]);
                        } else {
                            return new FASymbol(symbol, symbol);
                        }
                    });
                }
            }

            faEdges[i] = edges;
        }

        return new FA(faNodes, faEdges);
    }

    public getNode(index: number): FANode {
        if(this.nodes[index] === undefined) {
            throw new Error(`Unknown node ${index}`);
        }

        return this.nodes[index];
    }

    public next(index: number, symbol: number): number | null {
        for(let [child, edges] of Object.entries(this.edges[index])) {
            for(let edge of edges) {
                if(edge.contains(symbol)) {
                    return parseInt(child);
                }
            }
        }

        return null;
    }
}
export class FASymbol {
    private start: number;
    private end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }

    public contains(value: number) {
        return value >= this.start && value <= this.end;
    }
}
export class FANode {
    private lazy: boolean;
    private skip: boolean;
    private terminal?: string;
    
    constructor(lazy: boolean, skip: boolean, terminal?: string) {
        this.lazy = lazy;
        this.skip = skip;
        this.terminal = terminal;
    }

    public isSkip(): boolean {
        return this.skip;
    }

    public isLazy(): boolean {
        return this.lazy;
    }

    public isTerminal(): boolean {
        return this.terminal !== null;
    }

    public getTerminal(): string {
        return this.terminal as string;
    }
}

export class AST {
    private nodes: ASTNode[];
    private edges: {[key: number]: number[]};

    constructor(nodes: ASTNode[], edges: {[key: number]: number[]}) {
        this.nodes = nodes;
        this.edges = edges;
    }

    public node(index: number): ASTNode | null {
        return this.nodes[index];
    }

    public children(index: number): number[] {
        if(!(index in this.edges)) return [];

        return this.edges[index];
    }

    public child(index: number, tag: number): number | null {
        let childIndex = this.children(index).find(edge => {
            let node = this.node(edge); 
            return node instanceof BranchNode && node.getSymbol() === tag.toString();
        });

        if(childIndex === undefined) return null;
        else return childIndex;
    }

    public tokens(index: number): Token[] {
        let tokens: Token[] = [];

        let queue = [index];
        while(queue.length > 0) {
            let nodeIndex = queue.pop();
            let node = this.node(nodeIndex);

            if(node instanceof BranchNode) {
                queue = [...queue, ...this.edges[nodeIndex]];
            } else if(node instanceof TokenNode) {
                tokens.push(node.getToken());
            }
        }

        return tokens;
    }

    public lexeme(index: number): string {
        return this.tokens(index).map(token => token.getLexeme()).join("");
    }

    public toDot(): string {
        let output = `digraph {\ncharset="UTF-8" splines=true splines=spline rankdir=LR\nnode[shape=record,fontname=Sans];\n`;

        output += this.nodes.map((node, index) => `${index}[label="${node.toDot()}"]\n`).join("");
        output += Object.entries(this.edges).map(([parent, children]) => children.map(child => `${parent}->${child}\n`).join("")).join("");
        output += "}\n";

        return output;
    }
}
export abstract class ASTNode {
    public abstract toDot(): string;
}
export class BranchNode extends ASTNode {
    private symbol: string;

    constructor(symbol: string) {
        super();
        this.symbol = symbol;
    }

    public getSymbol(): string {
        return this.symbol;
    }

    public toDot(): string {
        return this.symbol;
    }
}
export class TokenNode extends ASTNode {
    private token: Token;

    constructor(token: Token) {
        super();
        this.token = token;
    }

    public getToken(): Token {
        return this.token;
    }

    public toDot(): string {
        return this.token.toDot();
    }
}

export class ParseTable {
    private table: {[key: number]: {[key: number]: number[]}};

    constructor(table: {[key: number]: {[key: number]: number[]}}) {
        this.table = table;
    }

    public next(atomIndex: number, tokenIndex: number): number[] | null {
        let rule = this.table[atomIndex]?.[tokenIndex];
        return rule;
    }

    public static fromGrammar(grammar: Grammar): ParseTable {
        let [firsts, follows] = GrammarSet.sets(grammar);
        let table: {[key: number]: {[key: number]: number[]}} = {};

        for(let symbolIndex = 0; symbolIndex < grammar.getAtomLength(); symbolIndex++) {
            let atom = grammar.getAtom(symbolIndex);

            if(!(atom instanceof GrammarSymbol)) continue;

            let entries: {[key: number]: number[]} = {};
            let rules = grammar.getRules(symbolIndex);
            for(let rule of rules) {
                let queue: number[] = [rule[0]];
                
                while(queue.length > 0) {
                    let nextIndex = queue.pop();
                    let nextAtom = grammar.getAtom(nextIndex);

                    if(nextAtom instanceof GrammarSymbol) {
                        let set = firsts.getSet(nextIndex);
                        queue = [...queue, ...set];
                    } else if(nextAtom instanceof GrammarEpsilon) {
                        let set = follows.getSet(symbolIndex);
                        queue = [...queue, ...set];
                    } else {
                        // TODO: Why can we reach here?
                        if(entries[nextIndex] !== undefined && entries[nextIndex].some((v, i) => v != rule[i])) {
                            // throw ["Not LL1", atom, nextAtom, entries[nextIndex], rule];
                        }
                        entries[nextIndex] = rule;
                    }
                }
            }
            table[symbolIndex] = entries;
        }

        return new ParseTable(table);
    }
}

export class GrammarSet {
    private sets: {[key: number]: Set<number>};
    private grammar: Grammar;

    constructor(sets: {[key: number]: Set<number>}, grammar: Grammar) {
        this.sets = sets;
        this.grammar = grammar;
    }

    public toString(): string {
        let output = "";
        for(let [symbolIndex, set] of Object.entries(this.sets)) {
            output += this.grammar.getAtom(parseInt(symbolIndex)).toString() + " = [";

            for(let atomIndex of set) {
                output += this.grammar.getAtom(atomIndex).toString() + " ";
            }

            output = output.trimEnd();
            output += "]\n";
        }

        return output;
    }

    public getSet(key: number): Set<number> | undefined {
        return this.sets[key];
    }

    private static first(grammar: Grammar, atomIndex: number, epsilonIndex: number, firsts: {[key: number]: Set<number>}): Set<number> {
        if(firsts[atomIndex] !== undefined) return firsts[atomIndex];

        let atom = grammar.getAtom(atomIndex);

        let firstSet = new Set<number>();
        if(atom instanceof GrammarSymbol) {
            for(let rule of grammar.getRules(atomIndex)) {
                for(let nextAtom of rule) {
                    if(atomIndex === nextAtom) continue;

                    let nextSet = this.first(grammar, nextAtom, epsilonIndex, firsts);

                    firstSet = new Set([...firstSet, ...nextSet]);

                    if(!nextSet.has(epsilonIndex)) break;
                }
            }

            firsts[atomIndex] = firstSet;
        } else {
            firstSet.add(atomIndex);
        }

        return firstSet;
    }

    private static firsts(grammar: Grammar): GrammarSet {
        let epsilonIndex = grammar.getEpsilonIndex();
        let firsts = {};

        for(let i = 0; i < grammar.getAtomLength(); i++) {
            this.first(grammar, i, epsilonIndex, firsts);
        }

        return new GrammarSet(firsts, grammar);
    }

    private static follows(grammar: Grammar, firsts: GrammarSet): GrammarSet {
        let epsilonIndex = grammar.getEpsilonIndex();
        let startIndex = grammar.getStartIndex();

        let startFollows: {[key: number]: Set<number>} = {};
        for(let i = 0; i < grammar.getAtomLength(); i++) {
            let atom = grammar.getAtom(i);

            if(atom instanceof GrammarSymbol) {
                let set = new Set<number>();
                if(i == startIndex) set.add(grammar.getEndIndex());
                startFollows[i] = set;
            }
        }

        for(let symbolIndex = 0; symbolIndex < grammar.getAtomLength(); symbolIndex++) {
            for(let rule of grammar.getRules(symbolIndex)) {
                for(let i = 0; i < rule.length; i++) {
                    let index = rule[i];
                    let atom = grammar.getAtom(index);

                    if(atom instanceof GrammarSymbol) {
                        let end = true;

                        let nextFollow = startFollows[index];
                        for(let j = i + 1; j < rule.length; j++) {
                            let nextIndex = rule[j];
                            let nextFirst = firsts.getSet(nextIndex);

                            if(nextFirst === undefined) {
                                nextFirst = new Set<number>();
                                if(nextIndex != epsilonIndex) nextFirst.add(nextIndex);
                            }

                            nextFollow = new Set([...nextFollow, ...nextFirst]);
                            startFollows[index] = nextFollow;

                            if(!nextFirst.has(epsilonIndex)) {
                                end = false;
                                break;
                            }

                            nextFollow.add(nextIndex);
                        }

                        if(end) nextFollow.add(symbolIndex);

                        nextFollow.delete(index);
                    }
                }
            }
        }

        let follows: {[key: number]: Set<number>} = {};
        for(let symbolIndex of Object.keys(startFollows)) {
            let followSet = new Set<number>();
            let queue = [parseInt(symbolIndex)];
            let seen = new Set<number>();

            while(queue.length > 0) {
                let nextAtom = queue.pop();

                if(seen.has(nextAtom)) continue;
                seen.add(nextAtom);

                for(let childIndex of startFollows[nextAtom]) {
                    let childAtom = grammar.getAtom(childIndex);

                    if(childAtom instanceof GrammarSymbol) {
                        queue.push(childIndex);
                    } else if(!(childAtom instanceof GrammarEpsilon)) {
                        followSet.add(childIndex);
                    }
                }
            }

            follows[parseInt(symbolIndex)] = followSet;
        }

        return new GrammarSet(follows, grammar);
    }

    public static sets(grammar: Grammar): [GrammarSet, GrammarSet] {
        let firsts = this.firsts(grammar);
        let follows = this.follows(grammar, firsts);

        return [firsts, follows];
    }
}

export class Grammar {
    private atoms: GrammarAtom[];
    private expressions: {[key: number]: number[][]};

    constructor(atoms: GrammarAtom[], expressions: {[key: number]: number[][]}) {
        this.atoms = atoms;
        this.expressions = expressions;
    }

    public static deserialize(json: any): Grammar {
        let grammarAtoms: GrammarAtom[] = json.a.map((atom: any) => {
            switch(atom[0]) {
                case 0:
                    return new GrammarEpsilon();
                case 1:
                    return new GrammarTerminal(atom[1] as string)
                case 2:
                    return new GrammarSymbol(atom[1] as string);
            }
        });

        let grammarExpressions: {[key: number]: number[][]} = {};
        for(let [index, expressions] of Object.entries(json.t)) {
            grammarExpressions[parseInt(index)] = expressions as any;
        }

        return new Grammar(grammarAtoms, grammarExpressions);
    }

    public getTokenIndex(token: Token): number {
        let index = this.atoms.findIndex(atom => atom instanceof GrammarTerminal && atom.getTerminal() == token.getType());
        if(index == null) throw new Error(`Could not find ${token}.`);
        return index;
    }

    public getAtomLength(): number {
        return this.atoms.length;
    }

    public getEndIndex(): number {
        return Number.MAX_VALUE;
    }

    public getStartIndex(): number {
        let index = this.atoms.findIndex(atom => atom instanceof GrammarSymbol && atom.getSymbol() == "START");
        return index;
    }

    public getAtom(index: number): GrammarAtom {
        if(index >= Number.MAX_VALUE) return new GrammarEnd();
        return this.atoms[index];
    }

    public getRules(index: number): number[][] {
        if(this.expressions[index] === undefined) return [];
        else return this.expressions[index];
    }

    public getEpsilonIndex(): number {
        return this.atoms.findIndex(atom => atom instanceof GrammarEpsilon);
    }
}
export class GrammarAtom {}
export class GrammarEpsilon extends GrammarAtom {
    public toString(): string {
        return "ε";
    }
}
export class GrammarTerminal extends GrammarAtom {
    private terminal: string;

    constructor(terminal: string) {
        super();
        this.terminal = terminal;
    }

    public toString(): string {
        return `${this.terminal}`;
    }

    public getTerminal(): string {
        return this.terminal;
    }
}
export class GrammarSymbol extends GrammarAtom {
    private symbol: string;

    constructor(symbol: string) {
        super();
        this.symbol = symbol;
    }

    public toString(): string {
        return `${this.symbol}`;
    }

    public getSymbol(): string {
        return this.symbol;
    }
}
export class GrammarEnd extends GrammarAtom {
    public toString(): string {
        return `$`;
    }
}

export class DerivationEntry {}
class DerivationSymbol extends DerivationEntry {
    private symbol: string;

    constructor(symbol: string) {
        super();
        this.symbol = symbol;
    }

    public getSymbol(): string {
        return this.symbol;
    }
}
export class DerivationEnter extends DerivationSymbol {}
export class DerivationExit extends DerivationSymbol {}
export class DerivationToken extends DerivationEntry {
    private token: Token;

    constructor(token: Token) {
        super();
        this.token = token;
    }

    public getToken(): Token {
        return this.token;
    }
}

export abstract class VisitorData {
    protected abstract mergeOne<T extends this>(other: T): void;

    public merge<T extends this>(tree: {[key: number]: T}): this {
        for(let key of Object.keys(tree).sort()) this.mergeOne(tree[key as any]);

        return this;
    }
}

type EnterStatement<T> = (ast: AST, index: number) => T;
type ExitStatement<T> = (ast: AST, index: number, tree: {[key: number]: T}) => T;
type EnterToken<T> = (token: Token) => T;
export abstract class Visitor<T> {
    private data: T;

    protected enter(ast: AST): void {}
    protected exit(data: T): void {}

    protected elseEnter(ast: AST, index: number) {}
    protected abstract elseExit(ast: AST, index: number, tree: {[key: number]: T}): T;
    protected abstract elseToken(token: Token): T;

    public getData(): T {
        return this.data;
    }

    private visitBranch(ast: AST, index: number, node: BranchNode): T {
        let enterStatement = `enter${node.getSymbol()}`;

        if(enterStatement in this) {
            ((this as any)[enterStatement] as EnterStatement<T>)(ast, index);
        } else{
            this.elseEnter(ast, index);
        }
        
        let tree: {[key: number]: T} = {};
        for(let child of ast.children(index)) {
            tree[child] = this.visitDeep(ast, child);
        }

        let exitStatement = `exit${node.getSymbol()}`;
        if(exitStatement in this) {
            return ((this as any)[exitStatement] as ExitStatement<T>)(ast, index, tree);
        } else {
            return this.elseExit(ast, index, tree);
        }
    }

    private visitToken(node: TokenNode): T {
        let enterToken = `token${node.getToken().getType()}`;

        if(enterToken in this) {
            ((this as any)[enterToken] as EnterToken<T>)(node.getToken());
        } else {
            return this.elseToken(node.getToken());
        }
    }

    private visitDeep(ast: AST, index: number): T {
        let node = ast.node(index);

        if(node instanceof BranchNode) return this.visitBranch(ast, index, node);
        if(node instanceof TokenNode) return this.visitToken(node);

        throw new Error("Unhandled");
    }

    public visit(ast: AST): this {
        this.enter(ast);
        this.data = this.visitDeep(ast, 0);
        this.exit(this.data);

        return this;
    }
}
