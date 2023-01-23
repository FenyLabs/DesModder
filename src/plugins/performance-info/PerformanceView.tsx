import Controller from "./Controller";
import "./PerformanceView.less";
import colorLib from "@kurkle/color";
import { Component, jsx } from "DCGView";
import Chart, {
  ChartConfiguration,
  ChartData,
  ChartDatasetProperties,
  Plugin,
} from "chart.js/auto";
import zoomPlugin, { zoom } from "chartjs-plugin-zoom";
import { Button, IconButton, IfElse, Tooltip } from "components";
import { format } from "i18n/i18n-core";
import DesModderController from "main/Controller";

Chart.register(zoomPlugin);
export class PerformanceView extends Component<{
  controller: () => Controller;
  desModderController: () => DesModderController;
}> {
  chart?: Chart;
  template() {
    return (
      <div class="dcg-popover-interior">
        {IfElse(
          () => {
            return this.props.controller().isProfiler;
          },
          {
            // Needs to be arrow function because of `this`
            true: () => {
              return this.templateProfiler();
            },
            false: () => {
              return this.templateBasic();
            },
          }
        )}
      </div>
    );
  }
  templateBasic() {
    return (
      <div class="dsm-pi-basic-menu">
        <div class="dsm-pi-pin-menu-button-container">
          <Tooltip
            gravity="s"
            tooltip={format("performance-info-sticky-tooltip")}
          >
            <IconButton
              iconClass={"dsm-icon-bookmark"}
              onTap={() => {
                this.props.desModderController().toggleMenuPinned();
              }}
              btnClass={() => ({
                "dsm-pi-pin-menu-button": true,
                "dsm-selected":
                  this.props.desModderController().pillboxMenuPinned,
              })}
            />
          </Tooltip>
        </div>
        <ul>
          <li>
            <strong>{format("performance-info-time-in-worker")}: </strong>
            {() =>
              Math.round(this.props.controller().getTimingData().timeInWorker)
            }
            ms
          </li>
          <li>
            <strong>{format("performance-info-compiling")}: </strong>
            {() =>
              Math.round(this.props.controller().getTimingData().updateAnalysis)
            }
            ms
          </li>
          <li>
            <strong>{format("performance-info-rendering")}: </strong>
            {() =>
              Math.round(
                this.props.controller().getTimingData().graphAllChanges
              )
            }
            ms
          </li>
          <li>
            <strong>{format("performance-info-other")}: </strong>
            {() => {
              const timingData = this.props.controller().getTimingData();
              return Math.round(
                timingData.timeInWorker -
                  (timingData.updateAnalysis + timingData.graphAllChanges)
              );
            }}
            ms
          </li>
        </ul>
        <div class="dsm-pi-refresh-state-button-container">
          <Tooltip tooltip={format("performance-info-refresh-graph-tooltip")}>
            <Button
              color="primary"
              class="dsm-pi-refresh-state-button"
              onTap={() => {
                this.props.controller().refreshState();
              }}
            >
              {format("performance-info-refresh-graph")}
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  }
  templateProfiler() {
    return (
      <div
        didMount={() => {
          this.profilerDidMount();
        }}
        didUpdate={() => {
          this.profilerDidUpdate();
        }}
        class="dsm-pi-basic-chart-container"
      >
        <div class="dsm-pi-pin-menu-button-container">
          <Tooltip
            gravity="s"
            tooltip={format("performance-info-sticky-tooltip")}
          >
            <IconButton
              iconClass={"dsm-icon-bookmark"}
              onTap={() => {
                this.props.desModderController().toggleMenuPinned();
              }}
              btnClass={() => ({
                "dsm-pi-pin-menu-button": true,
                "dsm-selected":
                  this.props.desModderController().pillboxMenuPinned,
              })}
            />
          </Tooltip>
        </div>
        <canvas id="dsm-pi-basic-chart"></canvas>
      </div>
    );
  }
  profilerDidMount() {
    const ctx = document.getElementById(
      "dsm-pi-basic-chart"
    ) as HTMLCanvasElement;
    const colors = ["rgb(45,112,179)", "rgb(199,68,64)", "rgb(96,66,166)"].map(
      colorLib
    );
    const pieData: ChartData<"doughnut", number[]> = {
      labels: ["Compiling", "Rendering", "Other"],
      datasets: [
        {
          data: [20, 10, 5],
          backgroundColor: colors.map((c) => c.alpha(0.4).rgbString()),
          borderColor: colors.map((c) => c.alpha(0.9).rgbString()),
          borderWidth: 2.5,
          hoverBackgroundColor: colors.map((c) => c.alpha(0.65).rgbString()),
          hoverBorderColor: colors.map((c) => c.alpha(1).rgbString()),
        },
      ],
    };
    const centerText: Plugin<"doughnut"> = {
      id: "centerText",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const data = chart.data as ChartData<"doughnut", number[]>;
        ctx.save();
        const x = chart.getDatasetMeta(0).data[0].x;
        const y = chart.getDatasetMeta(0).data[0].y;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "14px sans-serif";
        ctx.fillText(
          `${data.datasets[0].data.reduce((a, b) => {
            return a + b;
          })}ms`,
          x,
          y
        );
      },
    };
    const pieConfig: ChartConfiguration<"doughnut", number[]> = {
      type: "doughnut",
      data: pieData,
      options: {
        animation: false,
        plugins: {
          legend: {
            position: "bottom",
            align: "start",
            labels: {
              color: "black",
              font: {
                family: "Arial",
                size: 14,
                weight: "normal",
              },
              filter(item, data) {
                // Funny workaround to easily override label text
                item.text = `${item.text}: ${
                  data.datasets[0].data[item.index as number]
                }ms`;
                return true;
              },
            },
            onClick: undefined,
          },
          tooltip: {
            cornerRadius: 4,
            backgroundColor: "black",
            boxPadding: 3,
            callbacks: {
              label: (context) => {
                return context.formattedValue + "ms";
              },
            },
          },
        },
      },
      plugins: [centerText],
    };
    const barData: ChartData<"bar", { row: string; timing: number[] }[]> = {
      labels: ["Steps", "Expressions", "Expression Steps"],
      datasets: [
        {
          data: [],
          backgroundColor: colors[0].rgbString(),
          borderColor: colors[1].rgbString(),
          borderWidth: 1,
        },
      ],
    };

    const barConfig: ChartConfiguration<
      "bar",
      { row: string; timing: number[] }[]
    > = {
      type: "bar",
      data: barData,
      options: {
        animation: false,
        parsing: {
          yAxisKey: "row",
          xAxisKey: "timing",
        },
        scales: {
          y: {
            stacked: true,
            ticks: { display: false },
          },
          x: {
            stacked: false,
            ticks: { display: false },
            beginAtZero: false,
          },
        },
        indexAxis: "y",
        plugins: {
          zoom: {
            zoom: {
              wheel: {
                enabled: true,
              },
              mode: "x",
            },
            pan: {
              enabled: true,
              scaleMode: "x",
              threshold: 0.25,
              modifierKey: "shift"
            },
          },
        },
      },
    };
    this.chart = new Chart(ctx, barConfig);
  }
  profilerDidUpdate() {   
    if (!this.chart) return;
    let { stepsHistory, expressionsHistory } = this.props.controller();
    let data: { row: string; timing: number[] }[] = [];
    stepsHistory
      .forEach((step) => {
        data.push({ row: "Steps", timing: step.timing });
      });
    expressionsHistory
      .forEach((expression) => {
        data.push({ row: "Expressions", timing: expression.timing });
      });

    // @ts-ignore
    this.chart.data.datasets[0].data = data;
    /*let timingData = this.props.controller().getTimingData();
    this.chart.data.datasets[0].data = [
      timingData.updateAnalysis,
      timingData.graphAllChanges,
      timingData.timeInWorker -
        (timingData.updateAnalysis + timingData.graphAllChanges),
    ].map(Math.round);*/

    this.chart.update();
  }
}

export function MainPopupFunc(
  performanceViewController: Controller,
  desModderController: DesModderController
): PerformanceView {
  return (
    <PerformanceView
      controller={() => performanceViewController}
      desModderController={() => desModderController}
    />
  );
}
