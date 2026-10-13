(() => {
  interface Item { text: string; sub?: string }
  const api = (window as unknown as {
    api: {
      onSuggestItems(cb: (items: Item[], index: number) => void): void;
      suggestPick(text: string): void;
    };
  }).api;

  const list = document.getElementById("list") as HTMLDivElement;

  api.onSuggestItems((items, index) => {
    list.replaceChildren();
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "item" + (i === index ? " active" : "");

      const text = document.createElement("span");
      text.className = "text";
      text.textContent = item.text;
      row.appendChild(text);

      if (item.sub) {
        const sub = document.createElement("span");
        sub.className = "sub";
        sub.textContent = item.sub;
        row.appendChild(sub);
      }

      row.addEventListener("click", () => api.suggestPick(item.text));
      list.appendChild(row);
    });
  });
})();