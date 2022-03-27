import { MoonParser } from "./parser";
import * as fs from "fs";
import { MoonVM } from "./vm";

let test = fs.readFileSync("./unit/simple.m").toString() + "\n";

let data = new MoonParser().parse(test);

new MoonVM().run(data);
