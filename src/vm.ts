import { MoonOp } from "./op";
import { ADDRESS_SIZE, MEMORY } from "./config";
import { MoonData } from "./parser";

export abstract class VMMutation {}
export class OutputModify extends VMMutation {}
export class RegisterModify extends VMMutation {
    public register: number;
    public current: number;

    constructor(register: number, current: number) {
        super();
        this.register = register;
        this.current = current;
    }
}
export abstract class MemoryModify extends VMMutation {
    public address: number;
    public current: number;

    constructor(address: number, current: number) {
        super();
        this.address = address;
        this.current = current;
    }
}
export class WordModify extends MemoryModify {}
export class ByteModify extends MemoryModify {}
export class ErrorModify extends VMMutation {
    public error: string;

    constructor(error: string) {
        super();
        this.error = error;
    }
}
export class InfoModify extends VMMutation {
    public message: string;

    constructor(message: string) {
        super();
        this.message = message;
    }
}

export abstract class MoonVM {
    private pc: number;
    private registers: number[];
    private memory: Uint8Array;
    protected data: MoonData;
    protected history: VMMutation[];
    protected step: boolean;
    protected breakpoints: Set<number>;

    protected abstract enter(): void;
    protected abstract exit(): void;
    protected abstract getc(): Promise<number>;
    protected abstract putc(value: number): void;
    protected abstract debug(): Promise<void>;

    constructor(data: MoonData) {
        this.data = data;
    }

    protected init() {
        this.pc = this.data.entry;
        this.registers = new Array(16).fill(0);
        this.memory = new Uint8Array(new Array(MEMORY).fill(0));
        this.history = [];
        this.breakpoints = new Set<number>();
        this.step = true;

        for(let [offset, word] of this.data.words) this.setWord(offset, word, false);
        for(let [offset, byte] of this.data.bytes) this.setByte(offset, byte, false);
    }

    protected trace(mutation: VMMutation): void {
        this.history.push(mutation);
    }

    private setRegister(register: number, value: number) {
        this.trace(new RegisterModify(register, value));
        this.registers[register] = value;
    }

    public getRegisters(): number[] {
        return this.registers;
    }

    private setPC(pc: number) {
        this.pc = pc;
    }

    public getPC(): number {
        return this.pc;
    }

    public getMemory(): Uint8Array {
        return this.memory;
    }

    private setWord(address: number, word: number, trace: boolean=true): boolean {
        if(trace) this.trace(new WordModify(address, word));
        for(let i = 0; i < ADDRESS_SIZE; i++) this.memory[address + ADDRESS_SIZE - i - 1] = (word >> (i * 8)) & 0xFF;
        if(trace && address < MoonData.offset) {
            this.history.push(new ErrorModify(`Overwrote instruction at ${address} with ${word}`));
            return false;
        }
        return true;
    }

    private loadWord(address: number): number {
        let value = 0;
        for(let i = 0; i < ADDRESS_SIZE; i++) value |= this.memory[address + ADDRESS_SIZE - i - 1] << (i * 8);
        return value;
    }

    private setByte(address: number, byte: number, trace: boolean=true): boolean {
        if(trace) this.trace(new ByteModify(address, byte));
        this.memory[address] = byte & 0xFF;
        if(trace && address < MoonData.offset) {
            this.history.push(new ErrorModify(`Overwrote instruction at ${address} with ${byte}`));
            return false;
        }
        return true
    }

    private loadByte(address: number): number {
        return this.memory[address];
    }

    protected async next(): Promise<boolean> {
        let inst: number = this.loadWord(this.pc);

        let op: MoonOp = (inst >>> 26) & 0b111111;
        let ri: number = (inst >>> 22) & 0b1111;
        let rj: number = (inst >>> 18) & 0b1111;
        let rk: number = (inst >>> 14) & 0b1111;
        let k: number  = (inst >>> 0)  & 0b11111111_11111111;

        // TODO: Check edge condition.
        let sk = (k > 32768) ? k - 65536 : k;

        switch(op) {
            case MoonOp.bad:
                this.history.push(new ErrorModify(`Bad at ${this.pc}`));
                return false;
            case MoonOp.lw:
                if(this.registers[rj] + sk < MoonData.offset) {
                    this.history.push(`Read from invalid address ${this.registers[rj] + sk}`);
                    return false;
                }
                this.setRegister(ri, this.loadWord(this.registers[rj] + sk));
                break;
            case MoonOp.lb:
                if(this.registers[rj] + sk < MoonData.offset) {
                    this.history.push(`Read from invalid address ${this.registers[rj] + sk}`);
                    return false;
                }
                this.setRegister(ri, this.loadByte(this.registers[rj] + sk));
                break;
            case MoonOp.sw:
                if(!this.setWord(this.registers[rj] + sk, this.registers[ri])) return false;
                break;
            case MoonOp.sb:
                if(!this.setByte(this.registers[rj] + sk, this.registers[ri])) return false;
                break;
            case MoonOp.add:
                this.setRegister(ri, this.registers[rj] + this.registers[rk]);
                break;
            case MoonOp.sub:
                this.setRegister(ri, this.registers[rj] - this.registers[rk]);
                break;
            case MoonOp.mul:
                this.setRegister(ri, this.registers[rj] * this.registers[rk])
                break;
            case MoonOp.div:
                this.setRegister(ri, Math.trunc(this.registers[rj] / this.registers[rk]));
                break;
            case MoonOp.mod:
                this.setRegister(ri, Math.trunc(this.registers[rj] % this.registers[rk]));
                break;
            case MoonOp.and:
                this.setRegister(ri, this.registers[rj] & this.registers[rk]);
                break;
            case MoonOp.or:
                this.setRegister(ri, this.registers[rj] | this.registers[rk]);
                break;
            case MoonOp.not:
                this.setRegister(ri, ~this.registers[rj]);
                break;
            case MoonOp.ceq:
                this.setRegister(ri, (this.registers[rj] === this.registers[rk]) ? 1 : 0);
                break;
            case MoonOp.cne:
                this.setRegister(ri, (this.registers[rj] !== this.registers[rk]) ? 1 : 0);
                break;
            case MoonOp.clt:
                this.setRegister(ri, (this.registers[rj] < this.registers[rk]) ? 1 : 0);
                break;
            case MoonOp.cle:
                this.setRegister(ri, (this.registers[rj] <= this.registers[rk]) ? 1 : 0);
                break;
            case MoonOp.cgt:
                this.setRegister(ri, (this.registers[rj] > this.registers[rk]) ? 1 : 0);
                break;
            case MoonOp.cge:
                this.setRegister(ri, (this.registers[rj] >= this.registers[rk]) ? 1 : 0);
                break;
            case MoonOp.addi:
                this.setRegister(ri, this.registers[rj] + sk);
                break;
            case MoonOp.subi:
                this.setRegister(ri, this.registers[rj] - sk);
                break;
            case MoonOp.muli:
                this.setRegister(ri, this.registers[rj] * sk);
                break;
            case MoonOp.divi:
                this.setRegister(ri, Math.trunc(this.registers[rj] / sk));
                break;
            case MoonOp.modi:
                this.setRegister(ri, Math.trunc(this.registers[rj] % sk));
                break;
            case MoonOp.andi:
                this.setRegister(ri, this.registers[rj] & sk);
                break;
            case MoonOp.ori:
                this.setRegister(ri, this.registers[rj] | sk);
                break;
            case MoonOp.ceqi:
                this.setRegister(ri, (this.registers[rj] === sk) ? 1 : 0);
                break;
            case MoonOp.cnei:
                this.setRegister(ri, (this.registers[rj] !== sk) ? 1 : 0);
                break;
            case MoonOp.clti:
                this.setRegister(ri, (this.registers[rj] < sk) ? 1 : 0);
                break;
            case MoonOp.clei:
                this.setRegister(ri, (this.registers[rj] <= sk) ? 1 : 0);
                break;
            case MoonOp.cgti:
                this.setRegister(ri, (this.registers[rj] > sk) ? 1 : 0);
                break;
            case MoonOp.cgei:
                this.setRegister(ri, (this.registers[rj] >= sk) ? 1 : 0);
                break;
            case MoonOp.sl:
                this.setRegister(ri, (this.registers[rj] << sk) ? 1 : 0);
                break;
            case MoonOp.sr:
                this.setRegister(ri, (this.registers[rj] >> sk) ? 1 : 0);
                break;
            case MoonOp.gtc:
                this.setRegister(ri, await this.getc());
                break;
            case MoonOp.ptc:
                this.history.push(new OutputModify());
                this.putc(this.registers[ri]);
                break;
            case MoonOp.bz:
                if(this.registers[ri] === 0) {
                    this.setPC(k);
                    return true;
                }
                break;
            case MoonOp.bnz:
                if(this.registers[ri] !== 0) {
                    this.setPC(k);
                    return true;
                }
                break;
            case MoonOp.j:
                this.setPC(k);
                return true;
            case MoonOp.jr:
                this.setPC(this.registers[ri]);
                return true;
            case MoonOp.jl:
                this.setRegister(ri, this.pc + ADDRESS_SIZE);
                this.setPC(k);
                return true;
            case MoonOp.jlr:
                this.setRegister(ri, this.pc + ADDRESS_SIZE);
                this.setPC(this.registers[rj]);
                return true;
            case MoonOp.nop:
                break;
            case MoonOp.hlt:
                return false;
        }

        this.pc += ADDRESS_SIZE;

        return true;
    }

    public async run() {
        this.init();

        this.enter();
        while(true) {
            if(this.breakpoints.has(this.getPC())) {
                this.history.push(new InfoModify("Hit breakpoint"));
                this.step = true;
            }

            if(this.step) await this.debug();
            let next = await this.next();
            if(!next) {
                this.history.push(new InfoModify("Complete"));
                await this.debug();
                break;
            }
        }
        this.exit();
    }
}
