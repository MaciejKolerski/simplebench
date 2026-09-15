import { StrictMode, createContext, useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider, Slot, Fill } from "react-slot-fill";
const Context = createContext("missing");
function Item() {
  const context = useContext(Context);
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      {context} {count}
    </button>
  );
}
function Fixture() {
  const [visible, setVisible] = useState(true);
  const [name, setName] = useState("left");
  return (
    <Provider>
      <Context.Provider value="shared context">
        <button onClick={() => setVisible((v) => !v)}>Toggle fill</button>
        <button
          onClick={() => setName((n) => (n === "left" ? "right" : "left"))}
        >
          Move fill
        </button>
        <section aria-label="left">
          <Slot name="left" />
        </section>
        <section aria-label="right">
          <Slot name="right" />
        </section>
        {visible && (
          <Fill name={name}>
            <Item />
          </Fill>
        )}
      </Context.Provider>
    </Provider>
  );
}
export function mount(element: HTMLElement) {
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  return () => root.unmount();
}
