import fs from "node:fs";
import * as yaml from "js-yaml";

export default function () {
  return yaml.load(fs.readFileSync("content/site.yml", "utf8"));
}
