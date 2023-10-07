/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { Calc } from "src/globals";
import { PluginController } from "../PluginController";
import { hookIntoOverrideKeystroke } from "src/utils/listenerHelpers";
import { MathQuillField, MathQuillView } from "src/components";
import { getController } from "../intellisense/latex-parsing";

import "./index.less";

function isSupSubscriptMQElem(el?: HTMLElement) {
  return el?.classList.contains("dcg-mq-supsub");
}

function isWordMQElem(el?: HTMLElement) {
  return (
    el &&
    (el.classList.contains("dcg-mq-digit") ||
      el.tagName.toUpperCase() === "VAR" ||
      el.classList.contains("dcg-mq-supsub"))
  );
}

function isCtrlArrowSkippableSymbolMQElem(el?: HTMLElement) {
  return (
    el?.classList.contains("dcg-mq-bracket-container") ||
    el?.classList.contains("dcg-mq-fraction") ||
    el?.classList.contains("dcg-mq-large-operator") ||
    el?.classList.contains("dcg-mq-int") ||
    el?.classList.contains("dcg-mq-sqrt-container") ||
    el?.classList.contains("dcg-mq-nthroot-container")
  );
}

function isAtStartOrEndOfASubscriptOrSuperscript(
  mq: MathQuillField,
  right: boolean
) {
  const ctrlr = getController(mq);
  return (
    (ctrlr.cursor?.parent?._el?.classList.contains("dcg-mq-sup") ||
      ctrlr.cursor?.parent?._el?.classList.contains("dcg-mq-sub")) &&
    !ctrlr.cursor?.[right ? 1 : -1]
  );
}

interface BetterNavSettings {
  ctrlArrow: boolean;
  scrollableExpressions: boolean;
}

export default class BetterNavigation extends PluginController<BetterNavSettings> {
  static id = "better-navigation" as const;
  static enabledByDefault = true;
  static config = [
    {
      type: "boolean",
      default: true,
      key: "ctrlArrow",
    },
    {
      type: "boolean",
      default: false,
      key: "scrollableExpressions",
    },
  ] as const;

  removeHandlers() {
    for (const removeHandler of this.customRemoveHandlers) removeHandler();
  }

  afterConfigChange(): void {
    document.body.classList.toggle(
      "dsm-better-nav-scrollable-expressions",
      this.settings.scrollableExpressions
    );
    this.removeHandlers();
  }

  dispatcherID: string | undefined;

  customRemoveHandlers: (() => void)[] = [];

  keydownHandler = () => {
    if (Calc.focusedMathQuill && this.settings.ctrlArrow) {
      const remove = hookIntoOverrideKeystroke(
        Calc.focusedMathQuill.mq,
        (key, _) => {
          const mq = MathQuillView.getFocusedMathquill();

          if (!mq) return true;
          if (
            key !== "Ctrl-Left" &&
            key !== "Ctrl-Right" &&
            key !== "Ctrl-Shift-Left" &&
            key !== "Ctrl-Shift-Right" &&
            key !== "Ctrl-Backspace"
          )
            return true;

          // backspace is implicitly "left"
          const right = key === "Ctrl-Right" || key === "Ctrl-Shift-Right";
          const shift = key === "Ctrl-Shift-Left" || key === "Ctrl-Shift-Right";
          const backspace = key === "Ctrl-Backspace";

          // remove the "Ctrl-" to get the normal arrow op to emulate
          const arrowOp = backspace ? "Backspace" : key.slice(5);

          const ctrlr = getController(mq);

          // don't do anything if there's nowhere we can go
          const next = ctrlr.cursor?.[right ? 1 : -1];

          // if the next element is one of the following:
          // bracket, fraction, sum, product, integral, sqrt, nthroot
          // then skip over the entire thing when ctrl+arrowing (don't edit internals)
          // Shift-arrow already does this behavior perfectly so we first do that.
          // Then we do a normal arrow press to delete the selection.
          if (isCtrlArrowSkippableSymbolMQElem(next?._el)) {
            mq.keystroke(right ? "Shift-Right" : "Shift-Left");

            // remove selection if not holding down shift
            if (!shift) mq.keystroke(arrowOp);

            // skip over entire variable names, numbers, and operatornames
          } else if (
            isAtStartOrEndOfASubscriptOrSuperscript(mq, right) ||
            (next && isWordMQElem(next._el))
          ) {
            // leave start/end of sub/sup
            if (isAtStartOrEndOfASubscriptOrSuperscript(mq, right))
              mq.keystroke(arrowOp);

            let i = 0;
            while (
              isWordMQElem(ctrlr.cursor?.[right ? 1 : -1]?._el) &&
              i < 1000
            ) {
              // skip over super/subscript
              if (isSupSubscriptMQElem(ctrlr.cursor?.[right ? 1 : -1]?._el)) {
                mq.keystroke(right ? "Shift-Right" : "Shift-Left");

                // remove selection if not holding down shift
                if (!shift) mq.keystroke(arrowOp);
              } else {
                mq.keystroke(arrowOp);
              }

              // if at the start/end of a subscript/superscript block,
              // then escape it
              if (isAtStartOrEndOfASubscriptOrSuperscript(mq, right)) {
                mq.keystroke(arrowOp);
              }
              i++;
            }

            // treat it as a normal arrow key press in all other respects
          } else {
            mq.keystroke(arrowOp);
          }
          return false;
        },
        0,
        "better-nav-ctrl"
      );

      if (remove) this.customRemoveHandlers.push(remove);
    }
  };

  afterEnable() {
    this.afterConfigChange();
    document.addEventListener("keydown", this.keydownHandler);
  }

  afterDisable() {
    document.removeEventListener("keydown", this.keydownHandler);
    this.removeHandlers();
  }
}
