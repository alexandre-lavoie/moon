import { MoonParser } from "./parser";
import * as fs from "fs";
import { ByteModify, ErrorModify, InfoModify, MemoryModify, MoonVM, OutputModify, RegisterModify, WordModify } from "./vm";
import * as terminalKit from "terminal-kit";
import { ADDRESS_SIZE, WINDOW_SIZE, REGISTER_MAP } from "./config";
const term = terminalKit.terminal as any;

class NodeMoonVM extends MoonVM {
    private output: string;

    protected enter(): void {
        this.output = "";
    }

    protected exit(): void {
        process.exit();
    }

    private showMessage() {
        this.history.forEach(entry => {
            if(entry instanceof ErrorModify) {
                term.table([["^R" + entry.error + "^"]], {contentHasMarkup: true});
            } else if(entry instanceof InfoModify) {
                term.table([["^B" + entry.message + "^"]], {contentHasMarkup: true});
            }
        });
    }

    private showCPU() {
        let modifiedRegister = -1;
        let modifiedOutput = false;

        let last = this.history[this.history.length - 1];
        if(last instanceof RegisterModify) {
            modifiedRegister = last.register;
        } else if(last instanceof OutputModify) {
            modifiedOutput = true;
        }

        term.table([
            ["PC", this.getPC()],
            ["Breakpoints", [...this.breakpoints].join(",")],
            [(modifiedRegister >= 0) ? "^RRegisters^" : "Registers", this.getRegisters().map((r, i) => {
                let register = `r${i}`;

                if((REGISTER_MAP as any)[register]) register = (REGISTER_MAP as any)[register];

                return (i == modifiedRegister) ? `${register}=^R${r}^` : `${register}=${r}`;
            }).join(" ")],
            [(modifiedOutput) ? "^ROutput^" : "Output", (modifiedOutput) ? `^R${this.output}^` : this.output],
        ], {contentHasMarkup: true});
    }

    private showMemory(offset: number) {
        let lastModified = new Set<number>();
        let modified = new Set<number>();

        this.history.forEach((entry, index) => {
            let list = (index == this.history.length - 1) ? lastModified : modified;

            if(entry instanceof WordModify) {
                for(let i = 0; i < ADDRESS_SIZE; i++) list.add(entry.address + i);
            } else if(entry instanceof ByteModify) {
                list.add(entry.address);
            }
        });

        let memory = this.getMemory();
        let low = Math.max(0, offset - WINDOW_SIZE);
        let high = Math.min(memory.length, offset + WINDOW_SIZE);

        let chuncks = [];
        let chunk = [];
        for(let i = low; i < high; i++) {
            chunk.push(memory[i]);
            if(chunk.length == ADDRESS_SIZE) {
                chuncks.push(chunk);
                chunk = [];
            }
        }

        let data = chuncks.map((chunk, i) => {
            let byteString = chunk.map((value, j) => {
                let offset = i * chunk.length + j + low;
                return lastModified.has(offset) ? `^R${value}^` : (modified.has(offset) ? `^B${value}^` :`${value}`);
            }).join(" ");

            let wordString = chunk.map((value, j) => value << ((ADDRESS_SIZE - j - 1) * 8)).reduce((previous, value) => previous | value, 0);
            let address = i * ADDRESS_SIZE + low;
            let addressString = (this.breakpoints.has(address)) ? `^B${address}^` : `${address}`;

            return `${addressString} : ${byteString} > ${wordString}`;
        }).join("\n");

        term.table([
            [(lastModified.size > 0) ? `^RMemory (${offset})^` : `Memory (${offset})`],
            [data]
        ], {contentHasMarkup: true});
    }

    protected async debug(): Promise<void> {
        let selectedIndex = 1;
        let memoryOffset = WINDOW_SIZE;

        let lastMemory: MemoryModify = [...this.history].reverse().find(entry => entry instanceof MemoryModify) as any;
        if(lastMemory) memoryOffset = lastMemory.address;

        loop:
        while(true) {
            term.clear();

            this.showMessage();
            this.showCPU();
            this.showMemory(memoryOffset);
            
            let memory = this.getMemory();

            let option: any = await new Promise(resolve => term.singleLineMenu(["Scroll", "Step", "Run", "Breakpoint", "Exit"], {
                selectedIndex,
                align: "center"
            }, (_: any, input: any) => resolve(input)));
            selectedIndex = option.selectedIndex;

            switch(selectedIndex) {
                case 0:
                    let selectedIndex = 1;

                    offset:
                    while(true) {
                        term.clear();

                        this.showCPU();
                        this.showMemory(memoryOffset);

                        let option: any = await new Promise(resolve => term.singleLineMenu(["Up", "Down", "Offset", "Exit"], {
                            selectedIndex,
                            align: "center"
                        }, (_: any, input: any) => resolve(input)));
                        selectedIndex = option.selectedIndex;

                        switch(selectedIndex) {
                            case 0:
                                memoryOffset = Math.max(0, memoryOffset - ADDRESS_SIZE);
                                break;
                            case 1:
                                memoryOffset = Math.min(memory.length, memoryOffset + ADDRESS_SIZE);
                                break;
                            case 2:
                                term.clear();
                                this.showMemory(memoryOffset);
                                term("Offset: ");
                                memoryOffset = await new Promise(resolve => term.inputField((_: any, input: string) => {
                                    if(input.startsWith("+")) resolve(memoryOffset + parseInt(input.substring(1)));
                                    else if(input.startsWith("-")) resolve(memoryOffset - parseInt(input.substring(1)));
                                    else resolve(parseInt(input));
                                }));
                                break;
                            case 3:
                                break offset;
                        }
                    }

                    break;
                case 1:
                    break loop;
                case 2:
                    this.step = false;
                    break loop;
                case 3:
                    term.clear();

                    this.showCPU();
                    
                    let symbols = Object.keys(this.data.symbols.symbols);
                    let option: any = await new Promise(resolve => term.singleLineMenu(symbols, {}, (_: any, input: any) => resolve(input)));
                    let address = this.data.symbols.symbols[option.selectedText];

                    if(this.breakpoints.has(address)) this.breakpoints.delete(address)
                    else this.breakpoints.add(address);

                    break;
                case 4:
                    process.exit();
            }
        }

        return;
    }

    protected async getc(): Promise<number> {
        term.clear();
        this.showCPU();
        term("Input: ");
        return await new Promise(resolve => term.inputField((_: any, input: string) => {
            resolve(input.charCodeAt(0));
        }));
    }

    protected putc(value: number): void {
        this.output += `\\${value}`;
        this.history.push("out");
    }
}

async function main() {
    let test = fs.readFileSync("./unit/simple.m").toString() + "\n";

    let data = new MoonParser().parse(test);

    let vm = new NodeMoonVM(data);

    vm.run();
}

main();
