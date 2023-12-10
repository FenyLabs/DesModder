import { Component, jsx } from "#DCGView";
import RealtimeCollaboration from "..";
import { format } from "#i18n";
import "./RealtimeCollaboration.less";
import { Button, IfElse, Input, Tooltip } from "#components";

export default class MainPopup extends Component<{
  rtc: RealtimeCollaboration;
}> {
  template() {
    return (
      <div class="dcg-popover-interior">
        <div class="dcg-popover-title">
          {format("realtime-collaboration-name")}
        </div>
        {IfElse(() => this.props.rtc().status === "connected", {
          true: () => <div>connected</div>,
          false: () => this.optionsDisconnected(),
        })}
      </div>
    );
  }

  optionsDisconnected() {
    const rtc = this.props.rtc();
    return (
      <div>
        <div
          class={() => ({
            "dsm-rtc-input-outer": true,
            "dsm-invalid": !rtc.roomId,
          })}
        >
          <span>{format("realtime-collaboration-room-id")}:</span>
          <Input
            class={{ "dsm-rtc-text-input": true }}
            value={() => rtc.getRoomId()}
            onInput={(s: string) => rtc.setRoomId(s)}
            placeholder={"abc123"}
            required={true}
            spellcheck={false}
          />
        </div>
        <div
          class={() => ({
            "dsm-rtc-input-outer": true,
            "dsm-invalid": !rtc.nickname,
          })}
        >
          <span>{format("realtime-collaboration-nickname")}:</span>
          <Input
            class="dsm-rtc-text-input"
            value={() => rtc.getNickname()}
            onInput={(s: string) => rtc.setNickname(s)}
            placeholder={""}
            required={true}
            spellcheck={false}
          />
        </div>
        <div class="dsm-rtc-connect-button-container">
          <Tooltip tooltip={format("realtime-collaboration-connect-tooltip")}>
            <Button
              color="primary"
              disabled={() =>
                !rtc.nickname || !rtc.roomId || rtc.status === "connecting"
              }
              class="dsm-rtc-connect-button"
              onTap={() => rtc.connect()}
            >
              {() =>
                rtc.status === "connecting"
                  ? format("realtime-collaboration-connecting")
                  : format("realtime-collaboration-connect")
              }
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  }
}

export function MainPopupFunc(rtc: RealtimeCollaboration) {
  return (rtc.menu = <MainPopup rtc={() => rtc} />);
}
