import { ADDRESS_SIZE, MoonOp } from "./op";
import { MoonData } from "./parser";

export class MoonVM {
    private pc: number;
    private registers: number[];
    private memory: Uint8Array;

    public getc(): number {
        return 65;
    }

    public putc(value: number) {
        console.log(String.fromCharCode(value));
    }

    public run(data: MoonData) {
        this.pc = data.entry;
        this.registers = new Array(16).fill(0);
        this.memory = new Uint8Array(new Array(4000).fill(0));

        for(let [offset, bytes] of data.instructions) {
            for(let i = 3; i >= 0; i--) {
                this.memory[offset + i] = bytes & 0xFF;
                bytes >>= 8;
            }
        }

        loop:
        while(true) {
            let op: MoonOp = (this.memory[this.pc] & 0b11111100) >> 2;
            let ri: number = (this.memory[this.pc] & 0b11) << 2 | (this.memory[this.pc + 1] & 0b11000000) >> 6;
            let rj: number = (this.memory[this.pc + 1] & 0b00111100) >> 2;
            let rk: number = (this.memory[this.pc + 1] & 0b11) << 2 | (this.memory[this.pc + 2] & 0b11000000) >> 6;
            let k: number = this.memory[this.pc + 2] << 8 | this.memory[this.pc + 3];
            let sk = k << 24 >> 24;

            switch(op) {
                case MoonOp.bad:
                    throw new Error(`Bad at ${this.pc}`);
                case MoonOp.lw:
                    this.registers[ri] = 0;
                    // TODO: Match endianess
                    for(let i = 0; i < 4; i++) this.registers[ri] |= this.memory[this.registers[rj] + k + i] << i * 8; 
                    break;
                case MoonOp.lb:
                    this.registers[ri] = this.memory[this.registers[rj] + k];
                    break;
                case MoonOp.sw:
                    this.memory[rj] = 0;
                    // TODO: Match endianess
                    for(let i = 0; i < 4; i++) this.memory[this.registers[rj] + k + i] |= (this.registers[rj] >> (i * 8)) & 0xFF; 
                    break;
                case MoonOp.sb:
                    this.memory[this.registers[rj] + k] = this.registers[ri] & 0xFF;
                    break;
                case MoonOp.add:
                    this.registers[ri] = this.registers[rj] + this.registers[rk];
                    break;
                case MoonOp.sub:
                    this.registers[ri] = this.registers[rj] - this.registers[rk];
                    break;
                case MoonOp.mul:
                    this.registers[ri] = this.registers[rj] * this.registers[rk];
                    break;
                case MoonOp.div:
                    this.registers[ri] = Math.trunc(this.registers[rj] / this.registers[rk]);
                    break;
                case MoonOp.mod:
                    this.registers[ri] = Math.trunc(this.registers[rj] % this.registers[rk]);
                    break;
                case MoonOp.and:
                    this.registers[ri] = this.registers[rj] & this.registers[rk];
                    break;
                case MoonOp.or:
                    this.registers[ri] = this.registers[rj] | this.registers[rk];
                    break;
                case MoonOp.not:
                    this.registers[ri] = ~this.registers[rj];
                    break;
                case MoonOp.ceq:
                    this.registers[ri] = (this.registers[rj] === this.registers[rk]) ? 1 : 0;
                    break;
                case MoonOp.cne:
                    this.registers[ri] = (this.registers[rj] !== this.registers[rk]) ? 1 : 0;
                    break;
                case MoonOp.clt:
                    this.registers[ri] = (this.registers[rj] < this.registers[rk]) ? 1 : 0;
                    break;
                case MoonOp.cle:
                    this.registers[ri] = (this.registers[rj] <= this.registers[rk]) ? 1 : 0;
                    break;
                case MoonOp.cgt:
                    this.registers[ri] = (this.registers[rj] > this.registers[rk]) ? 1 : 0;
                    break;
                case MoonOp.cge:
                    this.registers[ri] = (this.registers[rj] >= this.registers[rk]) ? 1 : 0;
                    break;
                case MoonOp.addi:
                    this.registers[ri] = this.registers[rj] + sk;
                    break;
                case MoonOp.subi:
                    this.registers[ri] = this.registers[rj] - sk;
                    break;
                case MoonOp.muli:
                    this.registers[ri] = this.registers[rj] * sk;
                    break;
                case MoonOp.divi:
                    this.registers[ri] = Math.trunc(this.registers[rj] / sk);
                    break;
                case MoonOp.modi:
                    this.registers[ri] = Math.trunc(this.registers[rj] % sk);
                    break;
                case MoonOp.andi:
                    this.registers[ri] = this.registers[rj] & sk;
                    break;
                case MoonOp.ori:
                    this.registers[ri] = this.registers[rj] | sk;
                    break;
                case MoonOp.ceqi:
                    this.registers[ri] = (this.registers[rj] === k) ? 1 : 0;
                    break;
                case MoonOp.cnei:
                    this.registers[ri] = (this.registers[rj] !== k) ? 1 : 0;
                    break;
                case MoonOp.clti:
                    this.registers[ri] = (this.registers[rj] < k) ? 1 : 0;
                    break;
                case MoonOp.clei:
                    this.registers[ri] = (this.registers[rj] <= k) ? 1 : 0;
                    break;
                case MoonOp.cgti:
                    this.registers[ri] = (this.registers[rj] > k) ? 1 : 0;
                    break;
                case MoonOp.cgei:
                    this.registers[ri] = (this.registers[rj] >= k) ? 1 : 0;
                    break;
                case MoonOp.sl:
                    this.registers[ri] = this.registers[rj] << k;
                    break;
                case MoonOp.sr:
                    this.registers[ri] = this.registers[rj] >> k;
                    break;
                case MoonOp.gtc:
                    this.registers[ri] = this.getc();
                    break;
                case MoonOp.ptc:
                    this.putc(this.registers[ri]);
                    break;
                case MoonOp.bz:
                    if(this.registers[ri] === 0) this.pc += k;
                    break;
                case MoonOp.bnz:
                    if(this.registers[ri] !== 0) this.pc += k;
                    break;
                case MoonOp.j:
                    this.pc += k;
                    break;
                case MoonOp.jr:
                    this.pc += this.registers[ri];
                    break;
                case MoonOp.jl:
                    this.registers[ri] = this.pc + ADDRESS_SIZE;
                    this.pc += k;
                    break;
                case MoonOp.jlr:
                    this.registers[ri] = this.pc + ADDRESS_SIZE;
                    this.pc += this.registers[rj];
                    break;
                case MoonOp.nop:
                    break;
                case MoonOp.hlt:
                    break loop;
            }

            this.pc += ADDRESS_SIZE;
        }
    }
}
