import { MoonOp, wordToInstr } from "../op";
import Config from "../config";
import { MoonData } from "../parser";

export abstract class VMMutation {}
export class OutputModify extends VMMutation {
    public addition: string;

    constructor(addition: string) {
        super();
        this.addition = addition;
    }
}
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
    protected config: Config;
    protected data: MoonData;
    protected history: VMMutation[];
    protected step: boolean;
    protected breakpoints: Set<number>;

    protected abstract enter(): void;
    protected abstract exit(): void;
    protected abstract getc(): Promise<number>;
    protected abstract putc(value: string): void;
    protected abstract debug(): Promise<void>;

    constructor(config: Config, data: MoonData) {
        this.data = data;
        this.config = config;
    }

    protected init() {
        this.pc = this.data.entry;
        this.registers = new Array(16).fill(0);
        this.memory = new Uint8Array(new Array(this.config.memorySize).fill(0));
        this.history = [];
        this.breakpoints = new Set<number>();
        this.step = true;

        if(this.config.debug) {
            for(let [symbol, index] of Object.entries(this.data.symbols.symbols)) {
                if(symbol.toLowerCase().startsWith("debug")) {
                    this.breakpoints.add(index);
                }
            }
        }

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
        for(let i = 0; i < this.config.addressSize; i++) this.memory[address + this.config.addressSize - i - 1] = (word >> (i * 8)) & 0xFF;
        if(trace && address < this.data.offset) {
            this.history.push(new ErrorModify(`Overwrote instruction at ${address} with ${word}`));
            return false;
        }
        return true;
    }

    private loadWord(address: number): number {
        let value = 0;
        for(let i = 0; i < this.config.addressSize; i++) value |= this.memory[address + this.config.addressSize - i - 1] << (i * 8);
        return value;
    }

    private setByte(address: number, byte: number, trace: boolean=true): boolean {
        if(trace) this.trace(new ByteModify(address, byte));
        this.memory[address] = byte & 0xFF;
        if(trace && address < this.data.offset) {
            this.history.push(new ErrorModify(`Overwrote instruction at ${address} with ${byte}`));
            return false;
        }
        return true
    }

    private loadByte(address: number): number {
        return this.memory[address];
    }

    protected async next(): Promise<boolean> {
        let word: number = this.loadWord(this.pc);
        let [op, ri, rj, rk, k] = wordToInstr(this.config, word);

        switch(op) {
            case MoonOp.bad:
                this.history.push(new ErrorModify(`Bad at ${this.pc}`));
                return false;
            case MoonOp.lw:
                if(this.registers[rj] + k < this.data.offset) {
                    this.history.push(`Read from invalid address ${this.registers[rj] + k}`);
                    return false;
                }
                this.setRegister(ri, this.loadWord(this.registers[rj] + k));
                break;
            case MoonOp.lb:
                if(this.registers[rj] + k < this.data.offset) {
                    this.history.push(`Read from invalid address ${this.registers[rj] + k}`);
                    return false;
                }
                this.setRegister(ri, this.loadByte(this.registers[rj] + k));
                break;
            case MoonOp.sw:
                if(!this.setWord(this.registers[rj] + k, this.registers[ri])) return false;
                break;
            case MoonOp.sb:
                if(!this.setByte(this.registers[rj] + k, this.registers[ri])) return false;
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
                this.setRegister(ri, this.registers[rj] + k);
                break;
            case MoonOp.subi:
                this.setRegister(ri, this.registers[rj] - k);
                break;
            case MoonOp.muli:
                this.setRegister(ri, this.registers[rj] * k);
                break;
            case MoonOp.divi:
                this.setRegister(ri, Math.trunc(this.registers[rj] / k));
                break;
            case MoonOp.modi:
                this.setRegister(ri, Math.trunc(this.registers[rj] % k));
                break;
            case MoonOp.andi:
                this.setRegister(ri, this.registers[rj] & k);
                break;
            case MoonOp.ori:
                this.setRegister(ri, this.registers[rj] | k);
                break;
            case MoonOp.ceqi:
                this.setRegister(ri, (this.registers[rj] === k) ? 1 : 0);
                break;
            case MoonOp.cnei:
                this.setRegister(ri, (this.registers[rj] !== k) ? 1 : 0);
                break;
            case MoonOp.clti:
                this.setRegister(ri, (this.registers[rj] < k) ? 1 : 0);
                break;
            case MoonOp.clei:
                this.setRegister(ri, (this.registers[rj] <= k) ? 1 : 0);
                break;
            case MoonOp.cgti:
                this.setRegister(ri, (this.registers[rj] > k) ? 1 : 0);
                break;
            case MoonOp.cgei:
                this.setRegister(ri, (this.registers[rj] >= k) ? 1 : 0);
                break;
            case MoonOp.sl:
                this.setRegister(ri, (this.registers[rj] << k) ? 1 : 0);
                break;
            case MoonOp.sr:
                this.setRegister(ri, (this.registers[rj] >> k) ? 1 : 0);
                break;
            case MoonOp.gtc:
                this.setRegister(ri, await this.getc());
                break;
            case MoonOp.ptc:
                let value = this.registers[ri];

                let valueStr = `\\u${value}`;
                if(value <= 127) valueStr = String.fromCharCode(value);

                this.history.push(new OutputModify(valueStr));
                this.putc(valueStr);
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
                this.setRegister(ri, this.pc + this.config.addressSize);
                this.setPC(k);
                return true;
            case MoonOp.jlr:
                this.setRegister(ri, this.pc + this.config.addressSize);
                this.setPC(this.registers[rj]);
                return true;
            case MoonOp.nop:
                break;
            case MoonOp.hlt:
                return false;
        }

        this.pc += this.config.addressSize;

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
