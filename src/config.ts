interface IConfig {
    architecture: number
    memory: number
    window: {
        memory: number
        pc: number
    }
    debug: boolean
    output: "normal" | "escape"
    registers: { [key: string]: string }
}

const DEFAULT_CONFIG: IConfig = {
    architecture: 32,
    memory: 4000,
    window: {
        memory: 10,
        pc: 6
    },
    debug: false,
    output: "normal",
    registers: {}
};

export default class Config {
    private data: IConfig;
    constructor(data: IConfig = null) {
        if (data == null) {
            this.data = DEFAULT_CONFIG;
        } else {
            this.data = data;
        }
    }

    public static fromJSON(json: any): Config {
        return new Config(json);
    }

    public get architecture(): number {
        return this.data.architecture;
    }

    public get debug(): boolean {
        return this.data.debug;
    }

    public get addressSize(): number {
        return Math.trunc(this.architecture / 8);
    }

    public get halfWordSize(): number {
        return Math.trunc(this.architecture / 2);
    }

    public get memorySize(): number {
        return this.data.memory * 4;
    }

    public get windowMemorySize(): number {
        return this.addressSize * this.data.window.memory;
    }

    public get windowPCSize(): number {
        return this.addressSize * this.data.window.pc;
    }

    public get topAddress(): number {
        return this.memorySize;
    }

    public get output(): "normal" | "escape" {
        return this.data.output;
    }

    public getRegister(index: number): string {
        let registerString = `r${index}`;
        if (this.data.registers[registerString]) registerString = this.data.registers[registerString];
        return registerString;
    }

    public fromRegister(register: string): number {
        if (!register.startsWith("r")) {
            register = Object.fromEntries(Object.entries(this.data.registers).map(r => r.reverse()))[register];
        }

        if (register == undefined) return -1;
        else return parseInt(register.substring(1));
    }
}
