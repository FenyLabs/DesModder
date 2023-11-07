import { PluginController } from "../PluginController";
import { updateView } from "./View";
import { CaptureMethod, SliderSettings, capture } from "./backend/capture";
import { OutFileType, exportFrames, initFFmpeg } from "./backend/export";
import { escapeRegex } from "./backend/utils";
import { MainPopupFunc } from "./components/MainPopup";
import { ExpressionModel } from "#globals";
import {
  keys,
  EvaluateSingleExpression,
  getCurrentGraphTitle,
} from "#utils/depUtils.ts";
import {
  ManagedNumberInputModel,
  ManagedNumberInputModelOpts,
} from "./components/ManagedNumberInput";
import { hookIntoFunction } from "#utils/listenerHelpers.ts";
import {
  Matrix3,
  approx3su,
  eulerFromOrientation,
  getOrientation,
  orientationFromEuler,
  setOrientation,
} from "../../globals/matrix3";

type FocusedMQ = string;

const DEFAULT_FILENAME = "DesModder_Video_Creator";

export default class VideoCreator extends PluginController {
  static id = "video-creator" as const;
  static enabledByDefault = true;
  readonly cleanupCallbacks: (() => void)[] = [];

  ffmpegLoaded = false;
  frames: string[] = [];
  isCapturing = false;
  captureCancelled = false;
  readonly fps = this.managedNumberInputModel("30", {
    afterLatexChanged: () => {
      // advancing here resets the timeout
      // in case someone uses a low fps like 0.0001
      this.advancePlayPreviewFrame(false);
    },
  });

  fileType: OutFileType = "mp4";
  outfileName: string | null = null;

  focusedMQ: FocusedMQ = "none";

  // ** export status
  isExporting = false;
  // -1 while pending/waiting
  // 0 to 1 during encoding
  exportProgress = -1;

  // ** capture methods
  #captureMethod: CaptureMethod = "once";
  sliderVariable = "a";
  readonly sliderSettings: SliderSettings = {
    min: this.managedNumberInputModel("0"),
    max: this.managedNumberInputModel("10"),
    step: this.managedNumberInputModel("1"),
  };

  actionCaptureState: "none" | "waiting-for-update" | "waiting-for-screenshot" =
    "none";

  currentActionID: string | null = null;
  readonly tickCount = this.managedNumberInputModel("10");
  readonly tickTimeStep = this.managedNumberInputModel("40");

  // ** capture sizing
  readonly captureHeight = this.managedNumberInputModel("");
  readonly captureWidth = this.managedNumberInputModel("");
  samePixelRatio = false;

  // ** orientation
  /** Writes angle (in radians) as string (in preferred degrees or radians). */
  angleToString(n: number) {
    if (this.cc.isDegreeMode()) {
      return (n / (Math.PI / 180)).toFixed(1);
    } else {
      return (n / (Math.PI * 2)).toFixed(3) + "\\tau";
    }
  }

  readonly zTip = this.managedNumberInputModel("", {
    afterLatexChanged: () => this.updateOrientationFromLatex(),
    defaultLatex: () => this.angleToString(this.getEulerOrientation().zTip),
  });

  readonly xyRot = this.managedNumberInputModel("", {
    afterLatexChanged: () => this.updateOrientationFromLatex(),
    defaultLatex: () => this.angleToString(this.getEulerOrientation().xyRot),
  });

  readonly zTipTo = this.managedNumberInputModel("", {
    defaultLatex: () => this.zTip.getLatexPopulatingDefault(),
  });

  readonly xyRotTo = this.managedNumberInputModel("", {
    defaultLatex: () => this.xyRot.getLatexPopulatingDefault(),
  });

  readonly zTipStep = this.managedNumberInputModel("0");
  readonly xyRotStep = this.managedNumberInputModel("0");

  readonly speedRot = this.managedNumberInputModel("", {
    afterLatexChanged: () => this.updateSpinningSpeedFromLatex(),
    defaultLatex: () => {
      const sd = this.getSpinningSpeedAndDirection();
      if (!sd) return "";
      return this.angleToString(sd.speed);
    },
  });

  // ** play preview
  previewIndex = 0;
  isPlayingPreview = false;
  playPreviewTimeout: number | null = null;
  isPlayPreviewExpanded = false;

  managedNumberInputModel(
    initLatex: string,
    opts?: ManagedNumberInputModelOpts
  ) {
    return new ManagedNumberInputModel(initLatex, this.calc, {
      ...opts,
      afterLatexChanged: () => {
        opts?.afterLatexChanged?.();
        this.updateView();
      },
    });
  }

  onKeydown = this._onKeydown.bind(this);
  _onKeydown(e: KeyboardEvent) {
    if (keys.lookup(e) === "Esc" && this.isPlayPreviewExpanded) {
      e.stopImmediatePropagation();
      this.togglePreviewExpanded();
    }
  }

  afterEnable() {
    this.calc.observe("graphpaperBounds", () => this.graphpaperBoundsChanged());
    this._applyDefaultCaptureSize();
    this.applySpinningOrientation();
    this.dsm.pillboxMenus?.addPillboxButton({
      id: "dsm-vc-menu",
      tooltip: "video-creator-menu",
      iconClass: "dcg-icon-film",
      popup: () => MainPopupFunc(this),
    });
    document.addEventListener("keydown", this.onKeydown);
    const controls = this.cc.grapher3d?.controls;
    if (controls) {
      const unhook = hookIntoFunction(
        controls,
        "copyWorldRotationToWorld",
        "video-creator-rotation-listener",
        0,
        () => this.applySpinningOrientation()
      );
      if (unhook) this.cleanupCallbacks.push(unhook);
      const keys = [
        "onTapStart",
        "onTapMove",
        "onTapUp",
        "onMouseWheel",
      ] as const;
      for (const k of keys) {
        const unhook = hookIntoFunction(
          controls,
          k,
          "video-creator-spinning-listener-" + k,
          0,
          () => this.applySpinningSpeedFromGraph()
        );
        if (unhook) this.cleanupCallbacks.push(unhook);
      }
    }
    const dispatcherID = this.cc.dispatcher.register((evt) => {
      if (evt.type === "set-graph-settings" && "degreeMode" in evt) {
        this.applySpinningOrientation();
      }
    });
    this.cleanupCallbacks.push(() =>
      this.cc.dispatcher.unregister(dispatcherID)
    );
  }

  afterDisable() {
    this.dsm.pillboxMenus?.removePillboxButton("dsm-vc-menu");
    document.removeEventListener("keydown", this.onKeydown);
    for (const cleanup of this.cleanupCallbacks) cleanup();
  }

  graphpaperBoundsChanged() {
    this.updateView();
  }

  updateView() {
    updateView(this);
  }

  async tryInitFFmpeg() {
    await initFFmpeg(this);
    this.ffmpegLoaded = true;
    this.updateView();
  }

  deleteAll() {
    this.frames = [];
    this.previewIndex = 0;
    this.updateView();
  }

  async exportFrames() {
    if (!this.isExporting) {
      await exportFrames(this);
    }
  }

  setExportProgress(ratio: number) {
    this.exportProgress = ratio;
    this.updateView();
  }

  isFPSValid() {
    const v = this.fps.getValue();
    return v >= 0;
  }

  getFPSNumber() {
    return this.fps.getValue();
  }

  setOutputFiletype(type: OutFileType) {
    this.fileType = type;
    this.updateView();
  }

  setOutfileName(name: string) {
    this.outfileName = name;
  }

  getOutfileName() {
    return (
      this.outfileName ?? getCurrentGraphTitle(this.calc) ?? DEFAULT_FILENAME
    );
  }

  set captureMethod(method: CaptureMethod) {
    this.#captureMethod = method;
    this.updateView();
  }

  get captureMethod() {
    return this.isCaptureMethodValid(this.#captureMethod)
      ? this.#captureMethod
      : "once";
  }

  isValidNumber(s: string) {
    return !isNaN(this.eval(s));
  }

  isValidLength(s: string) {
    const evaluated = this.eval(s);
    return !isNaN(evaluated) && evaluated >= 2;
  }

  eval(s: string) {
    return EvaluateSingleExpression(this.calc, s);
  }

  isCaptureMethodValid(method: CaptureMethod) {
    return method === "action"
      ? this.hasAction()
      : method === "ticks"
      ? this.cc.getPlayingSliders().length > 0 || this.cc.is3dProduct()
      : true;
  }

  isCaptureWidthValid() {
    return isValidLength(this.captureWidth.getValue());
  }

  isCaptureHeightValid() {
    return isValidLength(this.captureHeight.getValue());
  }

  _applyDefaultCaptureSize() {
    const size = this.calc.graphpaperBounds.pixelCoordinates;
    this.captureWidth.setLatexWithCallbacks(size.width.toFixed(0));
    this.captureHeight.setLatexWithCallbacks(size.height.toFixed(0));
  }

  applyDefaultCaptureSize() {
    this._applyDefaultCaptureSize();
    this.updateView();
  }

  isDefaultCaptureSizeDifferent() {
    const size = this.calc.graphpaperBounds.pixelCoordinates;
    return (
      this.captureWidth.getValue() !== Math.round(size.width) ||
      this.captureHeight.getValue() !== Math.round(size.height)
    );
  }

  getCaptureWidthNumber() {
    return this.captureWidth.getValue();
  }

  getCaptureHeightNumber() {
    return this.captureHeight.getValue();
  }

  setSamePixelRatio(samePixelRatio: boolean) {
    this.samePixelRatio = samePixelRatio;
    this.updateView();
  }

  _getTargetPixelRatio() {
    return (
      this.captureWidth.getValue() /
      this.calc.graphpaperBounds.pixelCoordinates.width
    );
  }

  getTargetPixelRatio() {
    return this.samePixelRatio ? 1 : this._getTargetPixelRatio();
  }

  getTickTimeStepNumber() {
    return this.tickTimeStep.getValue();
  }

  isTickTimeStepValid() {
    const ts = this.getTickTimeStepNumber();
    return !isNaN(ts) && ts > 0;
  }

  getMatchingSlider() {
    const regex = new RegExp(
      `^(\\\\?\\s)*${escapeRegex(this.sliderVariable)}(\\\\?\\s)*=`
    );
    return this.calc
      .getState()
      .expressions.list.find(
        (e) =>
          e.type === "expression" &&
          typeof e.latex === "string" &&
          regex.test(e.latex)
      );
  }

  setSliderVariable(s: string) {
    this.sliderVariable = s;
  }

  isSliderVariableValid() {
    return this.getMatchingSlider() !== undefined;
  }

  isSliderSettingValid<T extends keyof SliderSettings>(key: T) {
    return !isNaN(this.sliderSettings[key].getValue());
  }

  getTickCountNumber() {
    return this.tickCount.getValue();
  }

  isTickCountValid() {
    const tc = this.getTickCountNumber();
    return Number.isInteger(tc) && tc > 0;
  }

  isAngleValid(v: number) {
    return !isNaN(v) && Math.abs(v) < 2 ** 30;
  }

  isCurrentXYRotValid() {
    return this.isAngleValid(this.xyRot.getValue());
  }

  isCurrentZTipValid() {
    return this.isAngleValid(this.zTip.getValue());
  }

  isXYRotStepValid() {
    return this.isAngleValid(this.xyRotStep.getValue());
  }

  isZTipStepValid() {
    return this.isAngleValid(this.zTipStep.getValue());
  }

  isXYRotToValid() {
    return this.isAngleValid(this.xyRotTo.getValue());
  }

  isZTipToValid() {
    return this.isAngleValid(this.zTipTo.getValue());
  }

  isSpeedRotValid() {
    return this.isAngleValid(this.speedRot.getValue());
  }

  isCurrentOrientationRelevant() {
    return this.cc.is3dProduct();
  }

  isToOrientationRelevant() {
    return (
      this.isCurrentOrientationRelevant() && this.captureMethod === "slider"
    );
  }

  isStepOrientationRelevant() {
    return (
      this.isCurrentOrientationRelevant() && this.captureMethod === "action"
    );
  }

  isSpeedOrientationRelevant() {
    return (
      this.isCurrentOrientationRelevant() &&
      this.captureMethod === "ticks" &&
      this.getSpinningSpeedAndDirection() !== undefined
    );
  }

  toggleSpinningDirection() {
    const sd = this.getSpinningSpeedAndDirection();
    if (!sd) return;
    const { dir, speed } = sd;
    this.setSpinningSpeedAndDirection({
      dir: dir === "zTip" ? "xyRot" : "zTip",
      speed,
    });
  }

  applySpinningSpeedFromGraph() {
    if (this._applyingSpinningOrientation) return;
    const sd = this.getSpinningSpeedAndDirection();
    if (!sd) return;
    const trigAngleMultiplier = this.trigAngleMultiplier();
    if (this.speedRot.getValue() * trigAngleMultiplier !== sd.speed) {
      this.speedRot.setLatexWithoutCallbacks("");
    }
  }

  updateSpinningSpeedFromLatex() {
    const sd = this.getSpinningSpeedAndDirection();
    if (!sd) return;
    const { dir } = sd;
    const trigAngleMultiplier = this.trigAngleMultiplier();
    let speed = this.speedRot.getValue() * trigAngleMultiplier;
    if (isNaN(speed)) speed = 0;
    this.setSpinningSpeedAndDirection({ dir, speed });
  }

  private speedAndDirectionToAxis3DSpeed({ dir, speed }: SpeedAndDirection) {
    const ss = speed >= 0 ? 1 : -1;
    if (dir === "xyRot") {
      return {
        axis3D: [0, 0, ss] as const,
        speed3D: Math.abs(speed),
      };
    } else {
      const { xyRot } = this.getEulerOrientation();
      return {
        axis3D: [ss * Math.cos(xyRot), -ss * Math.sin(xyRot), 0] as const,
        speed3D: Math.abs(speed),
      };
    }
  }

  setSpinningSpeedAndDirection(sd: SpeedAndDirection) {
    const controls = this.cc.grapher3d?.controls;
    if (!controls) return;
    if (!this.isAngleValid(sd.speed)) return;
    const { axis3D, speed3D } = this.speedAndDirectionToAxis3DSpeed(sd);
    controls.axis3D = axis3D;
    controls.speed3D = speed3D;
  }

  /** Returns undefined if the spin doesn't correspond to a simple zTip or xyRot. */
  getSpinningSpeedAndDirection(): undefined | SpeedAndDirection {
    const controls = this.cc.grapher3d?.controls;
    if (!controls) return undefined;
    const [x, y, z] = controls.axis3D;
    if (Math.abs(z) > 0.999) {
      return { dir: "xyRot", speed: controls.speed3D * Math.sign(z) };
    } else if (Math.abs(z) < 0.001) {
      const { xyRot } = this.getEulerOrientation();
      const dot = Math.cos(xyRot) * x - Math.sin(xyRot) * y;
      return { dir: "zTip", speed: controls.speed3D * Math.sign(dot) };
    } else {
      return undefined;
    }
  }

  getEulerOrientation() {
    const grapher3d = this.cc.grapher3d;
    if (!grapher3d) return { zTip: 0, xyRot: 0 };
    const mat = getOrientation(grapher3d);
    return eulerFromOrientation(mat);
  }

  trigAngleMultiplier() {
    return this.cc.isDegreeMode() ? Math.PI / 180 : 1;
  }

  _applyingSpinningOrientation = false;
  applySpinningOrientation() {
    const grapher3d = this.cc.grapher3d;
    if (!grapher3d) return;
    if (this._applyingSpinningOrientation) return;
    const mat = getOrientation(grapher3d);
    const tm = this._targetMatrixFromLatex;
    if (tm && approx3su(mat, tm)) {
      // Avoid a cycle where editing the latex changes the world changes the latex
      return;
    }
    this._targetMatrixFromLatex = undefined;
    // TODO: _applyingSpinningOrientation still needed? We have setLatexWithoutCallbacks now.
    this._applyingSpinningOrientation = true;
    this.zTip.setLatexWithoutCallbacks("");
    this.xyRot.setLatexWithoutCallbacks("");
    // TODO-updateView: should be tick?
    this.updateView();
    this._applyingSpinningOrientation = false;
  }

  _targetMatrixFromLatex: Matrix3 | undefined;
  updateOrientationFromLatex() {
    if (this._applyingSpinningOrientation) return;
    const grapher3d = this.cc.grapher3d;
    if (!grapher3d) return;
    const trigAngleMultiplier = this.trigAngleMultiplier();
    const zTip = this.zTip.getValue() * trigAngleMultiplier;
    const xyRot = this.xyRot.getValue() * trigAngleMultiplier;
    if (!this.isAngleValid(zTip) || !this.isAngleValid(xyRot)) return;
    const mat = orientationFromEuler(grapher3d, zTip, xyRot);
    this._targetMatrixFromLatex = mat;
    setOrientation(grapher3d, mat);
    this.applySpinningSpeedFromGraph();
  }

  incrementOrientationBySpeed(dtMs: number, sd: SpeedAndDirection) {
    const dt = dtMs / 1000;
    const { xyRot, zTip } = this.getEulerOrientation();
    if (sd.dir === "xyRot") {
      const newAngle = xyRot + sd.speed * dt;
      this.xyRot.setLatexWithCallbacks(this.angleToString(newAngle));
    } else {
      const newAngle = zTip + sd.speed * dt;
      this.zTip.setLatexWithCallbacks(this.angleToString(newAngle));
    }
  }

  async capture() {
    await capture(this);
  }

  areCaptureSettingsValid() {
    if (this.isCurrentOrientationRelevant())
      if (!this.isCurrentXYRotValid() || !this.isCurrentZTipValid())
        return false;
    if (this.isToOrientationRelevant())
      if (!this.isXYRotToValid() || !this.isZTipToValid()) return false;
    if (this.isStepOrientationRelevant())
      if (!this.isXYRotStepValid() || !this.isZTipStepValid()) return false;
    if (this.isSpeedOrientationRelevant())
      if (!this.isSpeedRotValid()) return false;
    if (!this.isCaptureWidthValid() || !this.isCaptureHeightValid())
      return false;
    switch (this.captureMethod) {
      case "once":
        return true;
      case "slider":
        return (
          this.isSliderVariableValid() &&
          this.isSliderSettingValid("min") &&
          this.isSliderSettingValid("max") &&
          this.isSliderSettingValid("step")
        );
      case "action":
        return this.isTickCountValid();
      case "ticks":
        return this.isTickCountValid() && this.isTickTimeStepValid();
      default: {
        const exhaustiveCheck: never = this.captureMethod;
        return exhaustiveCheck;
      }
    }
  }

  getActions() {
    return this.cc
      .getAllItemModels()
      .filter(
        (e) => e.type === "expression" && e.formula?.action_value !== undefined
      ) as ExpressionModel[];
  }

  hasAction() {
    return this.getActions().length > 0;
  }

  getCurrentAction() {
    const model = this.cc.getItemModel(this.currentActionID);
    if (model === undefined) {
      const action = this.getActions()[0];
      if (action !== undefined) {
        this.currentActionID = action.id;
      }
      return action;
    } else {
      return model as ExpressionModel;
    }
  }

  addToActionIndex(dx: number) {
    const actions = this.getActions();
    const currentActionIndex = actions.findIndex(
      (e) => e.id === this.currentActionID
    );
    // add actions.length to handle (-1) % n = -1
    const action =
      actions[(currentActionIndex + actions.length + dx) % actions.length];
    if (action !== undefined) {
      this.currentActionID = action.id;
    }
    this.updateView();
  }

  addToPreviewIndex(dx: number) {
    if (this.frames.length > 0) {
      this.previewIndex += dx;
      this.previewIndex += this.frames.length;
      this.previewIndex %= this.frames.length;
    } else {
      this.previewIndex = 0;
    }
    this.updateView();
  }

  advancePlayPreviewFrame(advance = true) {
    this.addToPreviewIndex(advance ? 1 : 0);
    const fps = this.getFPSNumber();
    if (this.isPlayingPreview) {
      if (this.playPreviewTimeout !== null) {
        window.clearTimeout(this.playPreviewTimeout);
      }
      this.playPreviewTimeout = window.setTimeout(() => {
        this.advancePlayPreviewFrame();
      }, 1000 / fps);
    }
  }

  togglePlayingPreview() {
    this.isPlayingPreview = !this.isPlayingPreview;
    if (this.frames.length <= 1) {
      this.isPlayingPreview = false;
    }
    this.updateView();

    if (this.isPlayingPreview) {
      this.advancePlayPreviewFrame();
    } else {
      if (this.playPreviewTimeout !== null) {
        clearInterval(this.playPreviewTimeout);
      }
    }
  }

  togglePreviewExpanded() {
    this.isPlayPreviewExpanded = !this.isPlayPreviewExpanded;
    this.updateView();
  }

  removeSelectedFrame() {
    this.frames.splice(this.previewIndex, 1);
    if (this.previewIndex >= this.frames.length) {
      this.previewIndex = this.frames.length - 1;
    }
    if (this.frames.length === 0) {
      if (this.isPlayPreviewExpanded) {
        this.togglePreviewExpanded();
      }
    }
    if (this.frames.length <= 1 && this.isPlayingPreview) {
      this.togglePlayingPreview();
    }
    this.updateView();
  }

  pushFrame(frame: string) {
    if (
      !this.isPlayingPreview &&
      this.previewIndex === this.frames.length - 1
    ) {
      this.previewIndex++;
    }
    this.frames.push(frame);
    this.updateView();
  }

  updateFocus(location: FocusedMQ, isFocused: boolean) {
    if (isFocused) {
      this.focusedMQ = location;
    } else if (location === this.focusedMQ) {
      this.focusedMQ = "none";
    }
    this.updateView();
  }

  isFocused(location: FocusedMQ) {
    return this.focusedMQ === location;
  }
}

function isValidLength(v: number) {
  return !isNaN(v) && v >= 2;
}

interface SpeedAndDirection {
  dir: "xyRot" | "zTip";
  speed: number;
}
