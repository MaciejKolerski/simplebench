import { Component, type ReactNode, type ReactElement } from "react";
export class Provider extends Component<{ children?: ReactNode }> {
  getFillsByName(name: string): Fill[];
  getChildrenByName(name: string): ReactNode[];
}
export class Fill extends Component<{
  name: string | symbol;
  children?: ReactNode;
}> {}
export class Slot extends Component<{
  name: string | symbol;
  children?: (elements: ReactElement[]) => ReactElement | null;
  fillChildProps?: Record<string, unknown>;
}> {}
