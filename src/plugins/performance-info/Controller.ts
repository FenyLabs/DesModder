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

interface WorkerStartLogMessage {
  type: "log-worker-start";
  time: number;
}
interface StepTimingLogMessage {
  type: "log-evaluation-step-timing";
  step: keyof TimingData;
  timing: [number, number];
  workerStart: number;
}

interface ExpressionTimingLogMessage {
  type: "log-expression-timing";
  step: keyof TimingData;
  id: string;
  timing: [number, number];
  workerStart: number;
}

export type PerformanceInfoMessage =
  | WorkerStartLogMessage
  | StepTimingLogMessage
  | ExpressionTimingLogMessage;

export default class Controller {
  timingDataHistory: TimingData[] = [];
  dispatchListenerID: string;
  isProfiler: boolean = true;

  workerStart: number = 0;
  stepsHistory: { step: keyof TimingData; timing: [number, number] }[] = [];
  expressionsHistory: {
    step: keyof TimingData;
    id: string;
    timing: [number, number];
  }[] = [];

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
        this.logTiming(message);
        break;
      case "log-expression-timing":
        this.logExpressionTiming(message);
        break;
    }
  }

  logWorkerStart({ time }: WorkerStartLogMessage) {
    this.workerStart = time;
    console.log(`worker started at ${time}`);
    updateView();
  }

  logTiming({ step, timing, workerStart }: StepTimingLogMessage) {
    this.workerStart = workerStart;
    this.stepsHistory.push({ step, timing });
    console.log(`${step} took ${timing[1]-timing[0]}ms (${timing[0]}-${timing[1]})`);
    updateView();
  }

  logExpressionTiming({
    step,
    timing,
    id,
    workerStart,
  }: ExpressionTimingLogMessage) {
    this.workerStart = workerStart;
    this.expressionsHistory.push({ step, timing, id });
    console.log(`${id} took ${timing[1]-timing[0]} on step ${step} (${timing[0]}-${timing[1]})`);
    updateView();
  }

  stop() {
    Calc.controller.dispatcher.unregister(this.dispatchListenerID);
  }
}
