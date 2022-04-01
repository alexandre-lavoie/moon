import Config from "./config";

export function wordIsInstr(config: Config, word: number) {
    let [op] = wordToInstr(config, word);
    return (op as number) > 0 && (op as number) < (MoonOp.last as number);
}

export function wordToInstr(config: Config, word: number): [MoonOp, number, number, number, number] {
    let offset = config.architecture - 18;
    let maxHalfWord = Math.pow(2, config.halfWordSize);

    let op: MoonOp = (word >>> (offset + 12)) & 0b111111;
    let ri: number = (word >>> (offset + 8)) & 0b1111;
    let rj: number = (word >>> (offset + 4)) & 0b1111;
    let rk: number = (word >>> offset) & 0b1111;
    let k: number = (word >>> 0) & (maxHalfWord - 1);

    let sk = (k > maxHalfWord / 2) ? k - maxHalfWord : k;

    return [op, ri, rj, rk, sk];
}

export function instrAToWord(config: Config, op: MoonOp, ri: number, rj: number, rk: number): number {
    let offset = config.architecture - 18;
    return (op as number) << (offset + 12) | ri << (offset + 8) | rj << (offset + 4) | rk << offset;
}

export function instrBToWord(config: Config, op: MoonOp, ri: number, rj: number, k: number): number {
    let offset = config.architecture - 18;
    let maxHalfWord = Math.pow(2, config.halfWordSize);
    return (op as number) << (offset + 12) | ri << (offset + 8) | rj << (offset + 4) | k & (maxHalfWord - 1);
}

export enum MoonOp {
    bad, lw, lb, sw, sb, add, sub, mul, div, mod, and, or, not, ceq, cne, clt, cle, cgt, cge, addi, subi, muli, divi, modi, andi, ori, ceqi, cnei, clti, clei, cgti, cgei, sl, sr, gtc, ptc, bz, bnz, j, jr, jl, jlr, nop, hlt, entry, align, org, dw, db, res, last
}

const STRING_MOON_OP = {
    "lw": MoonOp.lw,
    "lb": MoonOp.lb,
    "sw": MoonOp.sw,
    "sb": MoonOp.sb,
    "add": MoonOp.add,
    "sub": MoonOp.sub,
    "mul": MoonOp.mul,
    "div": MoonOp.div,
    "mod": MoonOp.mod,
    "and": MoonOp.and,
    "or": MoonOp.or,
    "not": MoonOp.not,
    "ceq": MoonOp.ceq,
    "cne": MoonOp.cne,
    "clt": MoonOp.clt,
    "cle": MoonOp.cle,
    "cgt": MoonOp.cgt,
    "cge": MoonOp.cge,
    "addi": MoonOp.addi,
    "subi": MoonOp.subi,
    "muli": MoonOp.muli,
    "divi": MoonOp.divi,
    "modi": MoonOp.modi,
    "andi": MoonOp.andi,
    "ori": MoonOp.ori,
    "ceqi": MoonOp.ceqi,
    "cnei": MoonOp.cnei,
    "clti": MoonOp.clti,
    "clei": MoonOp.clei,
    "cgti": MoonOp.cgti,
    "cgei": MoonOp.cgei,
    "sl": MoonOp.sl,
    "sr": MoonOp.sr,
    "getc": MoonOp.gtc,
    "putc": MoonOp.ptc,
    "bz": MoonOp.bz,
    "bnz": MoonOp.bnz,
    "j": MoonOp.j,
    "jr": MoonOp.jr,
    "jl": MoonOp.jl,
    "jlr": MoonOp.jlr,
    "nop": MoonOp.nop,
    "hlt": MoonOp.hlt,
    "entry": MoonOp.entry,
    "align": MoonOp.align,
    "org": MoonOp.org,
    "dw": MoonOp.dw,
    "db": MoonOp.db,
    "res": MoonOp.res,
}

const MOON_OP_STRING = Object.fromEntries(Object.entries(STRING_MOON_OP).map(entry => entry.reverse()));

export function opToString(op: MoonOp): string {
    if (MOON_OP_STRING[op] != null) return MOON_OP_STRING[op];
    else return "BAD";
}

export function opFromString(label: string): MoonOp {
    if ((STRING_MOON_OP as any)[label] != null) return (STRING_MOON_OP as any)[label];
    else return MoonOp.bad;
}

export function formatWordInstr(config: Config, word: number) {
    let [op, ri, rj, rk, k] = wordToInstr(config, word);

    let opStr = opToString(op).padEnd(4, " ");
    let riStr = `^Y${config.getRegister(ri)}^:`;
    let rjStr = `^Y${config.getRegister(rj)}^:`;
    let rkStr = `^Y${config.getRegister(rk)}^:`;
    let kStr = `^M${k}^:`;

    let output = `^B${opStr}^: `;
    switch (op) {
        case MoonOp.lw:
        case MoonOp.lb:
            output += `${riStr}, ${kStr}(${rjStr})`;
            break;
        case MoonOp.sw:
        case MoonOp.sb:
            output += `${kStr}(${rjStr}), ${riStr}`;
            break;
        case MoonOp.jlr:
            output += `${riStr}, ${rjStr}`;
            break;
        case MoonOp.add:
        case MoonOp.sub:
        case MoonOp.mul:
        case MoonOp.div:
        case MoonOp.mod:
        case MoonOp.and:
        case MoonOp.or:
        case MoonOp.ceq:
        case MoonOp.cne:
        case MoonOp.clt:
        case MoonOp.cle:
        case MoonOp.cgt:
        case MoonOp.cge:
            output += `${riStr}, ${rjStr}, ${rkStr}`;
            break;
        case MoonOp.addi:
        case MoonOp.subi:
        case MoonOp.muli:
        case MoonOp.divi:
        case MoonOp.modi:
        case MoonOp.andi:
        case MoonOp.ori:
        case MoonOp.ceqi:
        case MoonOp.cnei:
        case MoonOp.clti:
        case MoonOp.clei:
        case MoonOp.cgti:
        case MoonOp.cgei:
            output += `${riStr}, ${rjStr}, ${kStr}`;
            break;
        case MoonOp.gtc:
        case MoonOp.ptc:
        case MoonOp.not:
        case MoonOp.jr:
            output += `${riStr}`;
            break;
        case MoonOp.j:
            output += `${kStr}`;
            break;
        case MoonOp.bz:
        case MoonOp.bnz:
        case MoonOp.sl:
        case MoonOp.sr:
        case MoonOp.jl:
            output += `${riStr}, ${kStr}`;
            break;
        case MoonOp.nop:
        case MoonOp.hlt:
            break;
        default:
            output += `${riStr}, ${rjStr}, [ ${rkStr}, ${kStr} ]`;
    }

    return output;
}
