import { MoonData, MoonParser } from "../parser";
import * as fs from "fs";
import { ByteModify, ErrorModify, InfoModify, MemoryModify, MoonVM, OutputModify, RegisterModify, WordModify } from ".";
import * as terminalKit from "terminal-kit";
import Config from "../config";
import { formatWordInstr, wordIsInstr } from "../op";
const term = terminalKit.terminal as any;

class NodeMoonVM extends MoonVM {
    private output: string;
    private memoryOffset: number;
    private track: string;

    constructor(config: Config, data: MoonData) {
        super(config, data);
        this.track = "";
    }

    protected enter(): void {
        this.output = "";
        this.memoryOffset = Math.trunc(this.config.windowMemorySize / 2);
    }

    protected exit(): void {
        process.exit();
    }

    private updateTrackOffset() {
        let last = this.history[this.history.length - 1];
        if (last !== undefined && last instanceof MemoryModify) {
            this.memoryOffset = last.address;
        } else if (this.track.startsWith("r")) {
            let index = parseInt(this.track.substring(1));
            this.memoryOffset = this.getRegisters()[index];
        }
    }

    private showMessage() {
        if(this.history.length == 0) return;

        let reverseHistory = [...this.history].reverse();

        let errorCount = 0;
        reverseHistory.forEach(entry => {
            if (entry instanceof ErrorModify) {
                errorCount++;
                term.table([[`^R${entry.error}^:`]], { contentHasMarkup: true });
            }
        });

        if (errorCount == 0 && reverseHistory[0] instanceof InfoModify) {
            term.table([[`^B${reverseHistory[0].message}^:`]], { contentHasMarkup: true });
        }
    }

    protected async warn(message: string) {
        term.clear();
        term.table([[`^Y${message}^:`]], { contentHasMarkup: true });
        await new Promise(resolve => term.inputField((_: any, input: string) => resolve(input)));
    }

    private showOutput() {
        let modifiedOutput = false;

        let last = this.history[this.history.length - 1];
        if (last instanceof OutputModify) {
            modifiedOutput = true;
        }

        term.table([
            [(modifiedOutput) ? "^ROutput^:" : "Output"],
            [(modifiedOutput) ? `^R${this.output}^:` : this.output],
        ], { contentHasMarkup: true });
    }

    private showCPU() {
        let modifiedRegister = -1;

        let last = this.history[this.history.length - 1];
        if (last instanceof RegisterModify) {
            modifiedRegister = last.register;
        }

        let registerStr = this.getRegisters().map((r, i) => {
            let register = this.config.getRegister(i);
            return (i == modifiedRegister) ? `^Y${register}^:=^R${r}^:` : `^Y${register}^:=${r}`;
        }).join(" ");

        term.table([
            [(modifiedRegister >= 0) ? "^RRegisters^:" : "Registers", registerStr],
            ["Breakpoints", [...this.breakpoints].join(",")],
        ], { contentHasMarkup: true });
    }

    private showMemory(label: string, offset: number, windowSize: number, showModify: boolean = true, track: string = null) {
        let lastModified = new Set<number>();
        let modified = new Set<number>();

        this.history.forEach((entry, index) => {
            let list = (index == this.history.length - 1) ? lastModified : modified;

            if (entry instanceof WordModify) {
                for (let i = 0; i < this.config.addressSize; i++) list.add(entry.address + i);
            } else if (entry instanceof ByteModify) {
                list.add(entry.address);
            }
        });

        let memory = this.getMemory();

        let halfWindow = Math.trunc(windowSize / 2);
        let low = Math.max(0, offset - halfWindow);
        let high = Math.min(memory.length, offset + halfWindow);
        if (offset - halfWindow < 0) {
            high = Math.min(memory.length, windowSize - Math.max(0, low));
        } else if (offset + halfWindow > memory.length) {
            low = Math.max(0, offset - (windowSize - (memory.length - Math.min(memory.length, offset))));
        }

        let chuncks = [];
        let chunk = [];
        for (let i = low; i < high; i++) {
            chunk.push(memory[i]);
            if (chunk.length == this.config.addressSize) {
                chuncks.push(chunk);
                chunk = [];
            }
        }


        let data = chuncks.map((chunk, i) => {
            let word = chunk.map((value, j) => value << ((this.config.addressSize - j - 1) * 8)).reduce((previous, value) => previous | value, 0);
            let address = i * this.config.addressSize + low;

            let symbols = this.data.symbols.getSymbols(address);
            let symbolString = "";
            if (symbols.length > 0) {
                symbolString = `^C${symbols.join(", ")}^:: `;
            }

            let addressString = address.toString().padStart(4, "0");
            if (this.breakpoints.has(address)) addressString = `^B${addressString}^:`;
            else addressString = `^G${addressString}^:`;

            let message = "";
            if (wordIsInstr(this.config, word)) {
                message = formatWordInstr(this.config, word);
            } else {
                let byteString = chunk.map((value, j) => {
                    let offset = i * chunk.length + j + low;
                    let valueHex = value.toString(16).toUpperCase().padStart(2, "0");
                    return lastModified.has(offset) ? `^R${valueHex}^:` : (modified.has(offset) ? `^B${valueHex}^:` : `${valueHex}`);
                }).join(" ");

                message = `${byteString} ^M${word}^:`;
            }

            let pointers = [];
            if (this.getPC() == address) pointers.push("pc");
            if (address > 0) this.getRegisters().forEach((register, i) => {
                if (register === address) pointers.push(this.config.getRegister(i));
            });

            let pointerString = "";
            if (pointers.length > 0) pointerString = ` ^G< ${pointers.join(", ")}^:`;

            return `${addressString}: ${symbolString}${message.trim()}${pointerString}`;
        }).join("\n");

        let trackStr = "";
        if (track && track.length > 0) trackStr = ` [${track}]`

        term.table([
            [(lastModified.size > 0 && showModify) ? `^R${label} (${offset})${trackStr}^:` : `${label} (${offset})${trackStr}`],
            [data]
        ], { contentHasMarkup: true });
    }

    private showPCMemory() {
        this.showMemory("PC", this.getPC(), this.config.windowPCSize, false);
    }

    private showTrackMemory() {
        this.showMemory("Memory", this.memoryOffset, this.config.windowMemorySize, true, this.track);
    }

    private showAll() {
        term.clear();

        this.showMessage();
        this.showCPU();
        this.showPCMemory();
        this.showTrackMemory();
        this.showOutput();
    }

    protected async debug(): Promise<void> {
        this.updateTrackOffset();

        let selectedIndex = 0;

        loop:
        while (true) {
            this.showAll();

            let memory = this.getMemory();

            let option: any = await new Promise(resolve => term.singleLineMenu(["Step", "Run", "Memory", "Breakpoint", "Exit"], {
                selectedIndex,
                align: "center"
            }, (_: any, input: any) => resolve(input)));
            selectedIndex = option.selectedIndex;

            switch (selectedIndex) {
                case 0:
                    break loop;
                case 1:
                    this.step = false;
                    break loop;
                case 2:
                    let selectedIndex = 1;

                    offset:
                    while (true) {
                        term.clear();
                        this.showTrackMemory();

                        let option: any = await new Promise(resolve => term.singleLineMenu(["Up", "Down", "Offset", "Track", "Exit"], {
                            selectedIndex,
                            align: "center"
                        }, (_: any, input: any) => resolve(input)));
                        selectedIndex = option.selectedIndex;

                        let input: string = "";
                        let autoComplete: string[] = [];
                        switch (selectedIndex) {
                            case 0:
                                this.memoryOffset = Math.max(0, this.memoryOffset - this.config.addressSize);
                                break;
                            case 1:
                                this.memoryOffset = Math.min(memory.length, this.memoryOffset + this.config.addressSize);
                                break;
                            case 2:
                                term.clear();
                                this.showTrackMemory();

                                term("Offset: ");
                                autoComplete = [...Object.keys(this.data.symbols.symbols), "pc"];
                                input = await new Promise(resolve => term.inputField({ autoComplete, autoCompleteMenu: true }, (_: any, input: string) => resolve(input)));

                                if (input.trim().startsWith("+")) this.memoryOffset = this.memoryOffset + parseInt(input);
                                else if (input.trim().startsWith("-")) this.memoryOffset = this.memoryOffset + parseInt(input);
                                else if (!isNaN(parseInt(input))) this.memoryOffset = parseInt(input);
                                else if (input.trim().toLowerCase() === "pc") this.memoryOffset = this.getPC();
                                else {
                                    let symbolOffset = this.data.symbols.symbols[input.trim()];
                                    if (symbolOffset !== undefined) this.memoryOffset = symbolOffset;
                                }

                                break;
                            case 3:
                                term.clear();
                                this.showTrackMemory();

                                term("Track: ");
                                autoComplete = new Array(16).fill(0).map((_, i) => this.config.getRegister(i));
                                input = await new Promise(resolve => term.inputField({ autoComplete, autoCompleteMenu: true }, (_: any, input: string) => resolve(input)));

                                let registerIndex = this.config.fromRegister(input);
                                if (registerIndex >= 0) this.track = `r${registerIndex}`;
                                else this.track = "";

                                this.updateTrackOffset();

                                break;
                            case 4:
                                break offset;
                        }
                    }

                    break;
                case 3:
                    term.clear()

                    this.showCPU();

                    term("Breakpoint: ");
                    let autoComplete = Object.keys(this.data.symbols.symbols);
                    let input: string = await new Promise(resolve => term.inputField({ autoComplete, autoCompleteMenu: true }, (_: any, input: string) => resolve(input)));
                    let symbolAddress = this.data.symbols.symbols[input.trim()];

                    let breakpoint = null;
                    if (this.data.symbols.symbols[input.trim()]) {
                        breakpoint = symbolAddress;
                    } else if (input.startsWith("+")) {
                        breakpoint = this.getPC() + parseInt(input.substring(1));
                    } else if (input.startsWith("-")) {
                        breakpoint = this.getPC() - parseInt(input.substring(1));
                    } else {
                        breakpoint = parseInt(input);
                    }

                    if (!isNaN(breakpoint)) {
                        if (breakpoint % this.config.addressSize > 0) breakpoint -= this.config.addressSize - (breakpoint % this.config.addressSize);

                        if (this.breakpoints.has(breakpoint)) this.breakpoints.delete(breakpoint);
                        else this.breakpoints.add(breakpoint);
                    }

                    break;
                case 4:
                    process.exit();
            }
        }

        return;
    }

    protected async getc(): Promise<number> {
        term.clear();
        this.showOutput();
        term("Input: ");
        return await new Promise(resolve => term.inputField((_: any, input: string) => {
            resolve(input.charCodeAt(0));
        }));
    }

    protected putc(value: string): void {
        this.output += value;
    }
}

async function main() {
    let files = process.argv.slice(2);

    if (files.length == 0) {
        console.log("Usage: moon [lib ...] main");
        return;
    }

    let config;
    if (fs.existsSync("./moon.json")) {
        config = new Config(JSON.parse(fs.readFileSync("./moon.json").toString()));
    } else {
        config = new Config();
    }

    let source = "";
    files.forEach(path => {
        if (!fs.existsSync(path)) throw new Error(`Could not find file ${path}`);
        source += fs.readFileSync(path).toString() + "\n";
    });

    let parser = new MoonParser(config);
    let rom = parser.parse(source);
    let vm = new NodeMoonVM(config, rom);

    vm.run();
}

main();
