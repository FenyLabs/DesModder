import { PluginController } from "../PluginController";
import MainPopup, { MainPopupFunc } from "./components/RealtimeCollaboration";
import * as Y from "yjs";

// @ts-expect-error they messed up their types idk
import { WebsocketProvider as WebsocketProviderUntyped } from "y-websocket";
import { WebsocketProvider as WebsocketProviderTyped } from "node_modules/y-websocket/dist/src/y-websocket";
import { Calc } from "src/globals";

const WebsocketProvider =
  WebsocketProviderUntyped as typeof WebsocketProviderTyped;

export default class RealtimeCollaboration extends PluginController {
  static id = "realtime-collaboration" as const;
  static enabledByDefault = true;

  allowedSettings: (keyof Calc["settings"])[] = [];

  nickname?: string;
  roomId?: string;
  status: "disconnected" | "connecting" | "connected" = "disconnected";
  doc?: Y.Doc;

  menu?: MainPopup;

  afterEnable() {
    this.dsm.pillboxMenus?.addPillboxButton({
      id: "dsm-rtc-menu",
      tooltip: "realtime-collaboration-name",
      iconClass: "dsm-icon-live",
      popup: () => MainPopupFunc(this),
    });

    this.allowedSettings = Object.keys(this.calc.settings).filter(
      (k) => !ignoredSettings.includes(k)
    ) as any[];
  }

  getNickname() {
    return (this.nickname ??= this.getDefaultNickname());
  }

  getDefaultNickname() {
    return this.calc._calc.globalHotkeys.userController.name || "Anonymous";
  }

  setNickname(nickname: string) {
    this.nickname = nickname;
    this.menu?.update();
  }

  getRoomId() {
    return (this.roomId ??= this.generateRoomId());
  }

  generateRoomId() {
    // i know this doesn't need its own function but prettier makes this look weird inline
    return Math.floor(36 ** 5 + Math.random() * 5 * 36 ** 5).toString(36);
  }

  setRoomId(roomId: string) {
    this.roomId = roomId;
  }

  connect() {
    const ydoc = new Y.Doc();
    const wsProvider = new WebsocketProvider(
      "ws://localhost:1234/live",
      this.getRoomId(),
      ydoc,
      {}
    );

    this.doc = ydoc;

    wsProvider.on("status", (e: any) => {
      this.status = e.status;
      this.menu?.update();
    });

    const settings = ydoc.getMap("settings");
    if (settings.size === 0) {
      // room does not exist
      this.syncAllSettingsToYDoc();
    } else {
      // room exists
      this.syncSettingsFromYDoc();
    }

    settings.observe((e) => {
      this.settingsObserver(e);
    });

    this.registerObservers();
  }

  settingsObserver(e: Y.YMapEvent<any>) {
    if (!this.doc) return;
    if (e.changes.deleted) this.syncSettingsFromYDoc(e.keysChanged);
  }

  syncSettingToYDoc(key: string) {
    if (!this.doc) return;
    const settings = this.doc.getMap("settings");
    settings.set(key, this.calc.settings[key as keyof Calc["settings"]]);
  }

  syncAllSettingsToYDoc() {
    if (!this.doc) return;
    const settings = this.doc.getMap("settings");
    this.doc.transact(() => {
      for (const key of this.allowedSettings) {
        settings.set(key, this.calc.settings[key]);
      }
    });
  }

  syncSettingsFromYDoc(keys?: Set<string>) {
    if (!this.doc) return;
    let newSettings = this.doc.getMap("settings").toJSON();
    if (keys) {
      newSettings = Object.fromEntries(
        Object.entries(newSettings).filter(
          (e) => keys.has(e[0]) && this.allowedSettings.includes(e[0] as any)
        )
      );
    }
    this.calc.updateSettings(newSettings);
  }

  registerObservers() {
    for (const key of this.allowedSettings) {
      this.calc.settings.observe(key, () => this.syncSettingToYDoc(key));
    }
  }
}

const ignoredSettings = [
  "__eventObservers",
  "__observers",
  "__oldProperties",
  "__propertyComparators",
  "guid",
  "imageUploadCallback",
  "language",
  "brailleMode",
  "invertedColors",
];
