export class OrderedMap<T, K> {
    private map: Map<T, K>;
    private order: Map<T, number>;

    public constructor() { 
        this.map = new Map<T, K>();
        this.order = new Map<T, number>();
    }

    public set(k: T, v: K) {
        if (!this.map.has(k)) {
            this.map.set(k, v);
        } else {
            this.map.set(k, v);
            this.order.set(k, this.order.size);
        }
    }
}

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
}

export class FA {
    private nodes: FANode[];
    private edges: { [key: number]: { [key: number]: FASymbol[] } };

    constructor(nodes: FANode[], edges: { [key: number]: { [key: number]: FASymbol[] } }) {
        this.nodes = nodes;
        this.edges = edges;
    }

    public getNode(index: number): FANode {
        if (this.nodes[index] === undefined) {
            throw new Error(`Unknown node ${index}`);
        }

        return this.nodes[index];
    }

    public next(index: number, symbol: number): number | null {
        if (this.edges[index] == null) return null;

        for (let [child, edges] of Object.entries(this.edges[index])) {
            for (let edge of edges) {
                if (edge.contains(symbol)) {
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
    private edges: { [key: number]: number[] };

    constructor(nodes: ASTNode[], edges: { [key: number]: number[] }) {
        this.nodes = nodes;
        this.edges = edges;
    }

    public node(index: number): ASTNode | null {
        return this.nodes[index];
    }

    public children(index: number): number[] {
        if (!(index in this.edges)) return [];

        return this.edges[index];
    }

    public child(index: number, tag: number): number | null {
        let childIndex = this.children(index).find(edge => {
            let node = this.node(edge);
            return node instanceof BranchNode && node.getSymbol() === tag.toString();
        });

        if (childIndex === undefined) return null;
        else return childIndex;
    }

    public tokens(index: number): Token[] {
        let tokens: Token[] = [];

        let queue = [index];
        while (queue.length > 0) {
            let nodeIndex = queue.shift();
            let node = this.node(nodeIndex);

            if (node instanceof BranchNode) {
                queue = [...queue, ...this.edges[nodeIndex]];
            } else if (node instanceof TokenNode) {
                tokens.push(node.getToken());
            }
        }

        return tokens;
    }

    public lexeme(index: number): string {
        return this.tokens(index).map(token => token.getLexeme()).join("");
    }
}
export abstract class ASTNode { }
export class BranchNode extends ASTNode {
    private symbol: string;

    constructor(symbol: string) {
        super();
        this.symbol = symbol;
    }

    public getSymbol(): string {
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
}

export class ParseTable {
    private table: Map<number, Map<number, number[]>>;

    constructor(table: Map<number, Map<number, number[]>>) {
        this.table = table;
    }

    public next(atomIndex: number, tokenIndex: number): number[] | null {
        let rule = this.table.get(atomIndex)?.get(tokenIndex);
        return rule;
    }
}
export class GrammarAtom { }
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

export class DerivationEntry { }
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
export class DerivationEnter extends DerivationSymbol { }
export class DerivationExit extends DerivationSymbol { }
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

    public merge<T extends this>(tree: { [key: number]: T }): this {
        for (let key of Object.keys(tree).sort()) this.mergeOne(tree[key as any]);

        return this;
    }

    public mergeList<T extends this>(list: T[]): this {
        for (let entry of list) this.mergeOne(entry);

        return this;
    }
}

type EnterStatement<T> = (ast: AST, index: number) => T;
type ExitStatement<T> = (ast: AST, index: number, tree: { [key: number]: T }) => T;
type EnterToken<T> = (token: Token) => T;
export abstract class Visitor<T> {
    private data: T;

    protected enter(ast: AST): void { }
    protected exit(data: T): void { }

    protected elseEnter(ast: AST, index: number) { }
    protected abstract elseList(ast: AST, list: T[]): T;
    protected abstract elseExit(ast: AST, index: number, tree: { [key: number]: T }): T;
    protected abstract elseToken(token: Token): T;

    public getData(): T {
        return this.data;
    }

    private visitBranch(ast: AST, index: number, node: BranchNode): T {
        let enterStatement = `enter${node.getSymbol()}`;

        if (enterStatement in this) {
            ((this as any)[enterStatement] as EnterStatement<T>)(ast, index);
        } else {
            this.elseEnter(ast, index);
        }

        let children = ast.children(index);
        if (isNaN(parseInt(node.getSymbol()))) {
            let tree: { [key: number]: T } = {};

            for (let index of children) {
                let child = ast.node(index);

                if (child instanceof BranchNode) {
                    let symbolNumber = parseInt(child.getSymbol());

                    if (isNaN(symbolNumber)) {
                        tree[index] = this.visitDeep(ast, index);
                    } else {
                        tree[parseInt(child.getSymbol())] = this.visitDeep(ast, index);
                    }
                } else {
                    throw new Error("TODO");
                }
            }

            let exitStatement = `exit${node.getSymbol()}`;
            if (exitStatement in this) {
                return ((this as any)[exitStatement] as ExitStatement<T>)(ast, index, tree);
            } else {
                return this.elseExit(ast, index, tree);
            }
        } else {
            let list: T[] = [];

            for (let index of children) {
                list.push(this.visitDeep(ast, index));
            }

            let data = this.elseList(ast, list);

            return data
        }
    }

    private visitToken(node: TokenNode): T {
        let enterToken = `token${node.getToken().getType()}`;

        if (enterToken in this) {
            ((this as any)[enterToken] as EnterToken<T>)(node.getToken());
        } else {
            return this.elseToken(node.getToken());
        }
    }

    private visitDeep(ast: AST, index: number): T {
        let node = ast.node(index);

        if (node instanceof BranchNode) return this.visitBranch(ast, index, node);
        if (node instanceof TokenNode) return this.visitToken(node);

        throw new Error("Unhandled");
    }

    public visit(ast: AST): this {
        this.enter(ast);
        this.data = this.visitDeep(ast, 0);
        this.exit(this.data);

        return this;
    }
}

export class ByteStream {
    private stream: Uint8Array;
    private index: number;

    constructor(stream: Uint8Array) {
        this.stream = stream;
        this.index = 0;
    }

    public static fromString(string: string): ByteStream {
        return new ByteStream(new TextEncoder().encode(string));
    }

    private un(size: number): number {
        let v = 0;

        for (let i = 0; i < size; i++) {
            let b = this.u8();
            v |= b << (i * 8);
        }

        return v;
    }

    public u8(): number {
        return this.stream[this.index++];
    }

    public u16(): number {
        return this.un(2);
    }

    public str(size: number = -1): string {
        if (size == -1) size = this.u8();

        let bytes = [];
        for (let i = 0; i < size; i++) bytes.push(this.u8());

        return String.fromCharCode(...bytes);
    }

    public list<T>(value: (stream: this) => T): T[] {
        let size = this.u16();

        let list = [];
        for (let i = 0; i < size; i++) {
            list.push(value(this));
        }

        return list;
    }

    public dict<T, K>(key: (stream: this) => T, value: (stream: this) => K): Map<T, K> {
        let size = this.u16();

        let entries: [T, K][] = [];
        for (let i = 0; i < size; i++) {
            let k = key(this);
            let v = value(this);

            entries.push([k, v]);
        }

        return new Map(entries);
    }
}
