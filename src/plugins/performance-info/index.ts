import Controller, { PerformanceInfoMessage } from "./Controller";
import { destroyView, initView } from "./View";
import { Plugin } from "plugins";

let controller: Controller;

const performanceInfo: Plugin = {
  id: "performance-info",
  onEnable: () => {
    controller = new Controller();
    initView(controller);
    return controller;
  },
  onDisable: () => {
    controller.stop();
    destroyView();
  },
  onMessage: (message: PerformanceInfoMessage) => {
    controller?.handleMessage(message);
  },
  enabledByDefault: false,
} as const;

export default performanceInfo;
