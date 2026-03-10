const esbuild = require("esbuild");
const fs = require("fs");

const fileName = "bundle.js";

esbuild.build({
  entryPoints: ["main.js"],
  bundle: true,
  minify: true,
  sourcemap: false,
  outfile: "dist/bundle.js",
  loader: {
    ".css": "css"
  }
}).then(() => {

  // 读取 index.html
  let html = fs.readFileSync("index.html", "utf8");

  // 替换 script
  html = html.replace(
    /<script.*main\.js.*><\/script>/,
    `<script src="dist/${fileName}"></script>`
  );

  if (!fs.existsSync("dist")) {
    fs.mkdirSync("dist");
  }

  fs.writeFileSync("dist/index.html", html);

  console.log("打包完成:", fileName);

}).catch(() => process.exit(1));