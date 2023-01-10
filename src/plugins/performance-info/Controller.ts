import { updateView } from "./View";
import { DispatchedEvent, TimingData } from "globals/Calc";
import { Calc } from "globals/window";

const defaultTimingData: TimingData = {
  cacheWrites: 0,
  cacheReads: 0,
  cacheHits: 0,
  cacheMisses: 0,
  processStatements: 0,
  updateAnalysis: 0,
  updateIntersections: 0,
  publishAllStatuses: 0,
  computeAllLabels: 0,
  computeAriaDescriptions: 0,
  graphAllChanges: 0,
  processEvents: 0,
  timeInWorker: 0,
};

interface StepTimingLogMessage {
  type: "log-evaluation-step-timing";
  step: keyof TimingData;
  time: number;
}

interface ExpressionTimingLogMessage {
  type: "log-expression-timing";
  step: keyof TimingData;
  id: string;
  time: number;  
}

export type PerformanceInfoMessage =
  | StepTimingLogMessage
  | ExpressionTimingLogMessage;

export default class Controller {
  timingDataHistory: TimingData[] = [];
  dispatchListenerID: string;

  constructor() {
    this.dispatchListenerID = Calc.controller.dispatcher.register((e) => {
      if (e.type === "on-evaluator-changes") {
        this.onEvaluatorChanges(e);
      }
    });
  }

  onEvaluatorChanges(e: DispatchedEvent) {
    if (e.type !== "on-evaluator-changes") return;
    this.timingDataHistory?.push(e.timingData);
    if (this.timingDataHistory.length > 10) this.timingDataHistory.shift();
    updateView();
  }

  getTimingData() {
    return (
      this.timingDataHistory[this.timingDataHistory.length - 1] ??
      defaultTimingData
    );
  }

  refreshState() {
    Calc.controller._showToast({ message: "Refreshing graph..." });
    Calc.setState(Calc.getState());
  }

  handleMessage(message: PerformanceInfoMessage) {
    switch (message.type) {
      case "log-evaluation-step-timing":
        this.logTiming(message)
        break;
      case "log-expression-timing":
        this.logExpressionTiming(message)
        break;
    }
  }

  logTiming({ step, time }: StepTimingLogMessage) {
    console.log(`${step} took ${Math.round(time)}ms`);
  }

  logExpressionTiming({ step, time, id }: ExpressionTimingLogMessage) {
    console.log(`${id} took ${Math.round(time)} on step ${step}}`);
  }

  stop() {
    Calc.controller.dispatcher.unregister(this.dispatchListenerID);
  }
}
