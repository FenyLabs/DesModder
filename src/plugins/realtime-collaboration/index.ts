import { PluginController } from "../PluginController";
import MainPopup, { MainPopupFunc } from "./components/RealtimeCollaboration";
import * as Y from "yjs";

// @ts-expect-error they messed up their types idk
import { WebsocketProvider as WebsocketProviderUntyped } from "y-websocket";
import { WebsocketProvider as WebsocketProviderTyped } from "node_modules/y-websocket/dist/src/y-websocket";

const WebsocketProvider =
  WebsocketProviderUntyped as typeof WebsocketProviderTyped;

export default class RealtimeCollaboration extends PluginController {
  static id = "realtime-collaboration" as const;
  static enabledByDefault = true;

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

    wsProvider.on("status", (e: any) => {
      this.status = e.status;
      this.menu?.update();
    });

    const settings = ydoc.getMap("settings");
    if (settings.size === 0) {
      // room does not exist
      ydoc.transact(() => {
        for (const [key, value] of Object.values(this.calc.settings)) {
          if (ignoredSettings.includes(key)) return;
          settings.set(key, value);
        }
      });
    }
  }

  registerObservers() {
    this.calc.observe("settings.rtc", ((
      settings: typeof this.calc.settings
    ) => {}) as () => void);
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
];
