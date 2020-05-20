const fs = require("fs");
const assert = require("assert");
const { spawn } = require("child_process");

const blameFilename = "out/blame.json";
const specFilename = "spec.html";
const specBlameFilename = "spec-blame.html";

async function getRawBlame() {
  return new Promise(resolve => {
    const blame = spawn("git", ["blame", "-p", "spec.html"]);
    let out = "";
    blame.stdout.on("data", data => {
      out += data.toString();
    });
    blame.on("exit", code => {
      resolve(out);
    });
  });
}

function parseBlame(rawBlame) {
  const lines = [""];
  const commits = {};
  const commitToIndex = new Map();
  let currentCommit = null;

  for (const line of rawBlame.split("\n")) {
    if (line.startsWith("\t")) {
      continue;
    }

    let m = line.match(/^([A-Fa-f0-9]{40})\s+(\d+)\s+(\d+)(\s+(\d+))?$/);
    if (m) {
      const sha = m[1];
      const origLine = m[2];
      const line = m[3];

      if (sha in commits) {
        currentCommit = commits[sha];
      } else {
        currentCommit = {
          lineMap: {},
        };
        commits[sha] = currentCommit;
      }

      currentCommit.lineMap[line] = parseInt(origLine);

      let commitIndex;
      if (commitToIndex.has(sha)) {
        commitIndex = commitToIndex.get(sha);
      } else {
        commitIndex = commitToIndex.size;
        commitToIndex.set(sha, commitIndex);
      }
      lines[line] = commitIndex;
      continue;
    }

    m = line.match(/^([A-Za-z0-9-]+)\s(.+)$/);
    if (m) {
      const name = m[1];
      let value = m[2];
      if (name.startsWith("committer")) {
        continue;
      }
      if (name === "filename") {
        continue;
      }
      if (name === "author-time") {
        value = parseInt(value);
      }
      if (name === "previous") {
        m = value.match(/^([A-Fa-f0-9]{40})\s+(.+)/);
        if (m) {
          value = m[1];
        }
      }
      currentCommit[name] = value;
    }
  }

  return {
    commits,
    sha: [...commitToIndex.keys()],
    lines,
  };
}

function isAsciiWhitespace(c) {
  return /[\x09\x0a\x0c\x0d\x20]/.test(c);
}

function isAsciiWhitespaceSequence(s) {
  return /^[\x09\x0a\x0c\x0d\x20]*$/.test(s);
}

function* lex(inFile) {
  let buf = Buffer.alloc(1);
  let tokenValue = [];
  let line = 1;
  let isOpenUnget = false;

  function getTokenValue() {
    return Buffer.from(tokenValue);
  }

  function get() {
    let c;
    if (isOpenUnget) {
      isOpenUnget = false;

      let code = 0x3c;
      tokenValue.push(code);
      c = "<";
    } else {
      const bytesRead = fs.readSync(inFile, buf);
      if (bytesRead === 0) {
        return null;
      }
      const code = buf[0];
      tokenValue.push(code);
      c = String.fromCharCode(code);

      if (c === "\n") {
        line += 1;
      }
    }

    return c;
  }

  function ungetOpen() {
    assert.strictEqual(isOpenUnget, false);
    isOpenUnget = true;
    tokenValue.pop();
  }

  let c;
  let textType = "text";

  while (true) {
    tokenValue.length = 0;

    c = get();
    if (c === null) {
      break;
    }
    if (c === "<") {
      let name = "";

      c = get();
      if (c === "!") {
        c = get();

        if (c === "D") {
          // DOCTYPE
          while (true) {
            c = get();
            if (c === ">") {
              break;
            }
          }

          yield {
            line,
            type: "doctype",
            value: getTokenValue(),
          };
          continue;
        }

        // comment

        assert.strictEqual(c, "-");
        c = get();
        assert.strictEqual(c, "-");

        while (true) {
          c = get();
          if (c === "-") {
            c = get();
            if (c === "-") {
              c = get();
              if (c === ">") {
                break;
              }
            }
          }
        }

        yield {
          line,
          type: "comment",
          value: getTokenValue(),
        };
        continue;
      }

      // open/close/empty tag

      let type;
      if (c === "/") {
        type = "close";
      } else {
        type = "open";
        name += c;
      }

      while (true) {
        c = get();
        if (isAsciiWhitespace(c)) {
          while (true) {
            c = get();
            if (c === "\"") {
              // attribute value
              while (true) {
                c = get();
                if (c === "\"") {
                  break;
                }
                if (c === "\\") {
                  c = get();
                }
              }
            }
            else if (c === ">") {
              break;
            }
          }
          break;
        }
        if (c === ">") {
          break;
        }
        name += c;
      }

      if (name === "script") {
        if (type === "open") {
          textType = "script";
        } else {
          textType = "text";
        }
      } else if (name === "style") {
        if (type === "open") {
          textType = "style";
        } else {
          textType = "text";
        }
      }

      yield {
        line,
        name,
        type,
        value: getTokenValue(),
      };
      continue;
    }

    // text/script/style
    while (true) {
      c = get();
      if (c === "<") {
        ungetOpen();

        yield {
          line,
          type: textType,
          value: getTokenValue(),
        };
        break;
      }

      if (c === null) {
        yield {
          line,
          type: textType,
          value: getTokenValue(),
        };
        break;
      }
    }
  }
}

function filterBlame(blame) {
  const outFile = fs.openSync(specBlameFilename, "w");
  const inFile = fs.openSync(specFilename, "r");
  let injected = false;
  let lastLine = 0;
  for (const token of lex(inFile)) {
    if (token.type === "text") {
      if (!isAsciiWhitespaceSequence(token.value)) {
        if (token.line !== lastLine) {
          lastLine = token.line;
          fs.writeSync(outFile, `<a id="blame-${token.line}" class="blame" line="${token.line}"></a>`);
        }
      }
    }
    fs.writeSync(outFile, token.value);
    if (token.type === "close" && token.name === "style") {
      if (!injected) {
        injected = true;
        fs.writeSync(outFile, `
<link href="../scripts/blame.css" rel="stylesheet">
<script src="../scripts/blame.js"></script>
`);
      }
    }
  }
  fs.closeSync(inFile);
  fs.closeSync(outFile);
}

async function main() {
  const rawBlame = await getRawBlame();
  const blame = parseBlame(rawBlame);
  const outFile = fs.openSync(blameFilename, "w");
  fs.writeSync(outFile, JSON.stringify(blame));
  fs.closeSync(outFile);

  filterBlame(blame);
}

main();
