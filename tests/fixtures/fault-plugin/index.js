export function activate(context) {
  context.registerCommand("test.fault.run", () => {});
  context.registerFill("test.fault.status", () => null);
  context.subscribe("context", () => {});
  context.interval(() => {}, 1000);
  throw new Error("Intentional failure after partial activation");
}
