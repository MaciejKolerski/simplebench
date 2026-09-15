import {
  Children,
  Component,
  cloneElement,
  isValidElement,
  createContext,
  createElement,
} from "react";
const Context = createContext(null);

/*! *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */
/* global Reflect, Promise */

var extendStatics =
  Object.setPrototypeOf ||
  ({ __proto__: [] } instanceof Array &&
    function (d, b) {
      d.__proto__ = b;
    }) ||
  function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
  };

function __extends(d, b) {
  extendStatics(d, b);
  function __() {
    this.constructor = d;
  }
  d.prototype =
    b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
}

var __assign =
  Object.assign ||
  function __assign(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s)
        if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };

var Fill = /** @class */ (function (_super) {
  __extends(Fill, _super);
  function Fill() {
    return (_super !== null && _super.apply(this, arguments)) || this;
  }
  Fill.prototype.componentDidMount = function () {
    this.context.onFillMount(this);
  };
  Fill.prototype.componentDidUpdate = function (previous) {
    if (previous.name !== this.props.name) {
      this.context.onFillUnmount(this);
      this.context.onFillMount(this);
    } else this.context.onFillUpdated(this);
  };
  Fill.prototype.componentWillUnmount = function () {
    this.context.onFillUnmount(this);
  };
  Fill.prototype.render = function () {
    return null;
  };
  Fill.contextType = Context;
  return Fill;
})(Component);

var Manager = /** @class */ (function () {
  function Manager() {
    this._nextKey = 0;
    this._db = {
      byName: new Map(),
      byFill: new Map(),
    };
  }
  Manager.prototype.onFillMount = function (fill) {
    var children = Children.toArray(fill.props.children);
    var name = fill.props.name;
    fill._slotFillKey ??= ++this._nextKey;
    var component = { fill: fill, children: children, name: name };
    // If the name is already registered
    var reg = this._db.byName.get(name);
    if (reg) {
      reg.components.push(component);
      // notify listeners
      reg.listeners.forEach(function (fn) {
        return fn(reg.components);
      });
    } else {
      this._db.byName.set(name, {
        listeners: [],
        components: [component],
      });
    }
    this._db.byFill.set(fill, component);
  };
  Manager.prototype.onFillUpdated = function (fill) {
    // Find the component
    var component = this._db.byFill.get(fill);
    // Get the new elements
    var newElements = Children.toArray(fill.props.children);
    if (component) {
      // replace previous element with the new one
      component.children = newElements;
      var name_1 = component.name;
      // notify listeners
      var reg_1 = this._db.byName.get(name_1);
      if (reg_1) {
        reg_1.listeners.forEach(function (fn) {
          return fn(reg_1.components);
        });
      } else {
        throw new Error("registration was expected to be defined");
      }
    } else {
      throw new Error("component was expected to be defined");
    }
  };
  Manager.prototype.onFillUnmount = function (fill) {
    var oldComponent = this._db.byFill.get(fill);
    if (!oldComponent) {
      throw new Error("component was expected to be defined");
    }
    var name = oldComponent.name;
    var reg = this._db.byName.get(name);
    if (!reg) {
      throw new Error("registration was expected to be defined");
    }
    var components = reg.components;
    // remove previous component
    components.splice(components.indexOf(oldComponent), 1);
    // Clean up byFill reference
    this._db.byFill.delete(fill);
    if (reg.listeners.length === 0 && reg.components.length === 0) {
      this._db.byName.delete(name);
    } else {
      // notify listeners
      reg.listeners.forEach(function (fn) {
        return fn(reg.components);
      });
    }
  };
  /**
   * Triggers once immediately, then each time the components change for a location
   *
   * name: String, fn: (components: Component[]) => void
   */
  Manager.prototype.onComponentsChange = function (name, fn) {
    var reg = this._db.byName.get(name);
    if (reg) {
      reg.listeners.push(fn);
      fn(reg.components);
    } else {
      this._db.byName.set(name, {
        listeners: [fn],
        components: [],
      });
      fn([]);
    }
  };
  Manager.prototype.getFillsByName = function (name) {
    var registration = this._db.byName.get(name);
    if (!registration) {
      return [];
    } else {
      return registration.components.map(function (c) {
        return c.fill;
      });
    }
  };
  Manager.prototype.getChildrenByName = function (name) {
    var registration = this._db.byName.get(name);
    if (!registration) {
      return [];
    } else {
      return registration.components
        .map(function (component) {
          return component.children;
        })
        .reduce(function (acc, memo) {
          return acc.concat(memo);
        }, []);
    }
  };
  /**
   * Removes previous listener
   *
   * name: String, fn: (components: Component[]) => void
   */
  Manager.prototype.removeOnComponentsChange = function (name, fn) {
    var reg = this._db.byName.get(name);
    if (!reg) {
      throw new Error("expected registration to be defined");
    }
    var listeners = reg.listeners;
    listeners.splice(listeners.indexOf(fn), 1);
  };
  return Manager;
})();

var Provider = /** @class */ (function (_super) {
  __extends(Provider, _super);
  function Provider() {
    var _this = (_super !== null && _super.apply(this, arguments)) || this;
    _this._manager = new Manager();
    return _this;
  }
  Provider.prototype.render = function () {
    return createElement(
      Context.Provider,
      { value: this._manager },
      this.props.children,
    );
  };
  /**
   * Returns instances of Fill react components
   */
  Provider.prototype.getFillsByName = function (name) {
    return this._manager.getFillsByName(name);
  };
  /**
   * Return React elements that were inside Fills
   */
  Provider.prototype.getChildrenByName = function (name) {
    return this._manager.getChildrenByName(name);
  };

  return Provider;
})(Component);

var Slot = /** @class */ (function (_super) {
  __extends(Slot, _super);
  function Slot(props) {
    var _this = _super.call(this, props) || this;
    _this.state = { components: [] };
    _this.handleComponentChange = _this.handleComponentChange.bind(_this);
    return _this;
  }
  Slot.prototype.componentDidMount = function () {
    this.context.onComponentsChange(
      this.props.name,
      this.handleComponentChange,
    );
  };
  Slot.prototype.handleComponentChange = function (components) {
    this.setState({ components: components });
  };
  Object.defineProperty(Slot.prototype, "fills", {
    get: function () {
      return this.state.components.map(function (c) {
        return c.fill;
      });
    },
    enumerable: true,
    configurable: true,
  });
  Slot.prototype.componentDidUpdate = function (previous) {
    if (previous.name !== this.props.name) {
      this.context.removeOnComponentsChange(
        previous.name,
        this.handleComponentChange,
      );
      var name_1 = this.props.name;
      this.context.onComponentsChange(name_1, this.handleComponentChange);
    }
  };
  Slot.prototype.componentWillUnmount = function () {
    var name = this.props.name;
    this.context.removeOnComponentsChange(name, this.handleComponentChange);
  };
  Slot.prototype.render = function () {
    var _this = this;
    var aggElements = [];
    this.state.components.forEach(function (component, index) {
      var fill = component.fill,
        children = component.children;
      var fillChildProps = _this.props.fillChildProps;
      if (fillChildProps) {
        var transform = function (acc, key) {
          var value = fillChildProps[key];
          if (typeof value === "function") {
            acc[key] = function () {
              return value(fill, _this.fills);
            };
          } else {
            acc[key] = value;
          }
          return acc;
        };
        var fillChildProps2_1 = Object.keys(fillChildProps).reduce(
          transform,
          {},
        );
        children.forEach(function (child, index2) {
          if (typeof child === "number" || typeof child === "string") {
            throw new Error("Only element children will work here");
          }
          aggElements.push(
            cloneElement(
              child,
              __assign(
                { key: fill._slotFillKey + ":" + (child.key ?? index2) },
                fillChildProps2_1,
              ),
            ),
          );
        });
      } else {
        children.forEach(function (child, index2) {
          if (typeof child === "number" || typeof child === "string") {
            throw new Error("Only element children will work here");
          }
          aggElements.push(
            cloneElement(child, {
              key: fill._slotFillKey + ":" + (child.key ?? index2),
            }),
          );
        });
      }
    });
    if (typeof this.props.children === "function") {
      var element = this.props.children(aggElements);
      if (isValidElement(element) || element === null) {
        return element;
      } else {
        var message =
          "Slot render function must return a React element or null.";
        throw new Error(message);
      }
    } else {
      return aggElements;
    }
  };
  Slot.contextType = Context;
  return Slot;
})(Component);

export { Provider, Slot, Fill };
