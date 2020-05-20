let current = null;

class DateUtils {
  static toReadable(d) {
    try {
      const date = new Date(d);
      return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    } catch (e) {
      return d;
    }
  }
}

async function loadBlame() {
  const response = await fetch("blame.json");
  if (!response.ok) {
    return undefined;
  }
  return response.json();
}

let blamePromise = loadBlame();

function findParentByClassName(node, name) {
  while (node) {
    if ("classList" in node && node.classList.contains(name)) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

window.addEventListener("load", async () => {
  const blame = await blamePromise;

  let popupTimer = null;

  const popupWidth = 600;
  let popupNode = {
    popup: null,
    summary: null,
    author: null,
    date: null,
    commitLink: null,
    lineLink: null,
    compareLink: null,
  };
  const popopTimeout = 200;
  function showPopup(target) {
    const line = target.getAttribute("line");
    const sha = target.getAttribute("sha");
    const commit = blame.commits[sha];
    const origLine = commit.lineMap[line];

    const rect = target.getBoundingClientRect();
    const bottom = rect.top + window.scrollY + 4;
    let left = rect.left + rect.width + window.scrollX;
    if (left + popupWidth > document.body.offsetWidth) {
      left = document.body.offsetWidth - popupWidth;
    }

    if (!popupNode.popup) {
      popupNode.popup = document.createElement("div");
      popupNode.popup.classList.add("blame-popup");
      document.body.appendChild(popupNode.popup);

      popupNode.popup.addEventListener("mouseenter", event => {
        if (popupTimer) {
          clearTimeout(popupTimer);
          popupTimer = null;
        }
      });
      popupNode.popup.addEventListener("mouseleave", event => {
        popupTimer = setTimeout(() => {
          hidePopup();
        }, popopTimeout);
      });

      popupNode.summary = document.createElement("div");
      popupNode.summary.classList.add("blame-popup-summary");
      popupNode.popup.appendChild(popupNode.summary);

      const authorAndDate = document.createElement("div");
      authorAndDate.classList.add("blame-popup-author-and-date");
      popupNode.author = document.createElement("span");
      popupNode.author.classList.add("blame-popup-author");
      authorAndDate.appendChild(popupNode.author);

      popupNode.date = document.createElement("span");
      popupNode.date.classList.add("blame-popup-date");
      authorAndDate.appendChild(document.createTextNode(", "));
      authorAndDate.appendChild(popupNode.date);
      popupNode.popup.appendChild(authorAndDate);

      const linkBox = document.createElement("ul");
      linkBox.classList.add("blame-popup-links");

      let item = document.createElement("li");
      popupNode.commitLink = document.createElement("a");
      popupNode.commitLink.textContent = "Show commit";
      item.appendChild(popupNode.commitLink);
      linkBox.appendChild(item);

      item = document.createElement("li");
      popupNode.lineLink = document.createElement("a");
      popupNode.lineLink.textContent = "Show the line in commit";
      item.appendChild(popupNode.lineLink);
      linkBox.appendChild(item);

      item = document.createElement("li");
      popupNode.compareLink = document.createElement("a");
      popupNode.compareLink.textContent = "Compare with ecma262-compare (experimental)";
      item.appendChild(popupNode.compareLink);
      linkBox.appendChild(item);

      item = document.createElement("li");
      item.textContent = "(NYI) Show latest version without this line";
      linkBox.appendChild(item);
      item = document.createElement("li");
      item.textContent = "(NYI) Show earliest version with this line";
      linkBox.appendChild(item);

      popupNode.popup.appendChild(linkBox);
    }

    popupNode.popup.style.transform = `translateY(${bottom}px) translateX(${left}px)`;
    popupNode.commitLink.href = `https://github.com/tc39/ecma262/commit/${sha}`;
    popupNode.lineLink.href = `https://github.com/tc39/ecma262/commit/${sha}#diff-3540caefa502006d8a33cb1385720803R${origLine}`;
    popupNode.compareLink.href = `https://arai-a.github.io/ecma262-compare/?rev=${sha}`;
    popupNode.summary.textContent = commit.summary;
    popupNode.author.textContent = commit.author;
    const date = DateUtils.toReadable(commit["author-time"] * 1000);
    const tz = commit["author-tz"];
    popupNode.date.textContent = `${date} ${tz}`;
    popupNode.popup.style.display = "";
  }
  function hidePopup() {
    if (!popupNode.popup) {
      return;
    }
    popupNode.popup.style.display = "none";
  }

  createBlameColumn(blame);

  for (const node of document.getElementsByClassName("blame-column")) {
    node.addEventListener("mouseenter", event => {
      if (popupTimer) {
        clearTimeout(popupTimer);
        popupTimer = null;
      }
      showPopup(node);
    });
    node.addEventListener("mouseleave", event => {
      popupTimer = setTimeout(() => {
        hidePopup();
      }, popopTimeout);
    });
  }
});

function createBlameColumn(blame) {
  const container = document.getElementById("spec-container");

  const blameBoxes = [];
  for (const node of container.getElementsByClassName("blame")) {
    const rect = node.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    const top = rect.top + window.scrollY;
    const line = node.getAttribute("line");
    const shaIndex = blame.lines[line];
    const sha = blame.sha[shaIndex];

    blameBoxes.push({ left, top, line, sha, });
  }

  blameBoxes.sort((a, b) => {
    if (a.top !== b.top) {
      return a.top - b.top;
    }
    return a.left - b.left;
  });

  const grouped = [];
  let lastGroup = null;
  let lastTop = 0;
  for (const box of blameBoxes) {
    if (lastGroup === null || lastTop !== box.top) {
      if (lastGroup) {
        lastGroup.bottom = box.top;
      }
      lastGroup = { boxes: [box], top: box.top, bottom: 0, };
      lastTop = box.top;
      grouped.push(lastGroup);
    } else {
      lastGroup.boxes.push(box);
    }
  }

  const rect = container.getBoundingClientRect();
  const containerLeft = rect.left + window.scrollX;

  let dark = false;
  let lastSHA = '';
  for (const group of grouped) {
    let top = group.top;
    let bottom = group.bottom;
    let count = group.boxes.length;
    let height = (bottom - top) / count;

    for (const box of group.boxes) {
      if (box.sha != lastSHA) {
        lastSHA = box.sha;
        dark = !dark;
      }

      const column = document.createElement("div");
      column.classList.add("blame-column");
      column.setAttribute("line", box.line);
      column.setAttribute("sha", box.sha);
      column.style.position = "absolute";
      column.style.left = `${containerLeft}px`;
      column.style.top = `${top}px`;
      column.style.width = `16px`;
      column.style.height = `${height}px`;
      column.style.backgroundColor = dark ? "darkgray" : "lightgray";
      document.body.appendChild(column);

      top += height;
    }
  }
}
