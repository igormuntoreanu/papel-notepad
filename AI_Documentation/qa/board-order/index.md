# Board order dropdown

Captured against the dev server (`npm run dev`, http://localhost:8080) in Chromium.

![Board order dropdown](./01-board-order-dropdown.png)

- The **Board order** control is a real dropdown box: 1 px border, rounded corners,
  field background, a `ChevronDown` caret on the right, and a pointer cursor over the
  whole 34 px-high box.
- It offers exactly two options: **Title** and **Last edited** (default). "My order"
  is gone, so the board is always sorted and cards are no longer dragged into a
  hand-kept order (the card menu's Move earlier/later entries are gone too).
- A stored `sort: "manual"` from an earlier build falls back to **Last edited**.

Automated check from the same run: 2 `<option>`s (`title`, `recent`), `recent`
selected, caret present, `cursor: pointer`, `border-top-width: 1px`, no console
errors.
