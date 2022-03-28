export enum MoonOp {
    bad, lw, lb, sw, sb, add, sub, mul, div, mod,
    and, or, not, ceq, cne, clt, cle, cgt, cge,
    addi, subi, muli, divi, modi, andi, ori,
    ceqi, cnei, clti, clei, cgti, cgei, sl, sr,
    gtc, ptc, bz, bnz, j, jr, jl, jlr, nop, hlt,
    entry, align, org, dw, db, res
}

export function opFromString(label: string): MoonOp {
    switch (label) {
        case "lw": return MoonOp.lw;
        case "lb": return MoonOp.lb;
        case "sw": return MoonOp.sw;
        case "sb": return MoonOp.sb;
        case "add": return MoonOp.add;
        case "sub": return MoonOp.sub;
        case "mul": return MoonOp.mul;
        case "div": return MoonOp.div;
        case "mod": return MoonOp.mod;
        case "and": return MoonOp.and;
        case "or": return MoonOp.or;
        case "not": return MoonOp.not;
        case "ceq": return MoonOp.ceq;
        case "cne": return MoonOp.cne;
        case "clt": return MoonOp.clt;
        case "cle": return MoonOp.cle;
        case "cgt": return MoonOp.cgt;
        case "cge": return MoonOp.cge;
        case "addi": return MoonOp.addi;
        case "subi": return MoonOp.subi;
        case "muli": return MoonOp.muli;
        case "divi": return MoonOp.divi;
        case "modi": return MoonOp.modi;
        case "andi": return MoonOp.andi;
        case "ori": return MoonOp.ori;
        case "ceqi": return MoonOp.ceqi;
        case "cnei": return MoonOp.cnei;
        case "clti": return MoonOp.clti;
        case "clei": return MoonOp.clei;
        case "cgti": return MoonOp.cgti;
        case "cgei": return MoonOp.cgei;
        case "sl": return MoonOp.sl;
        case "sr": return MoonOp.sr;
        case "getc": return MoonOp.gtc;
        case "putc": return MoonOp.ptc;
        case "bz": return MoonOp.bz;
        case "bnz": return MoonOp.bnz;
        case "j": return MoonOp.j;
        case "jr": return MoonOp.jr;
        case "jl": return MoonOp.jl;
        case "jlr": return MoonOp.jlr;
        case "nop": return MoonOp.nop;
        case "hlt": return MoonOp.hlt;
        case "entry": return MoonOp.entry;
        case "align": return MoonOp.align;
        case "org": return MoonOp.org;
        case "dw": return MoonOp.dw;
        case "db": return MoonOp.db;
        case "res": return MoonOp.res;  
        default: return MoonOp.bad;      
    }
}
