import { BaseComponent } from "./BaseComponent.js";

export class Relay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ===== 电气参数 =====
        this.coilResistance = config.coilResistance || 120; // Ω
        this.currentResistance = 120; // Ω        用于万用表读取。
        this.pickupCurrent = config.pickupCurrent || 0.18;   // A
        this.releaseCurrent = config.releaseCurrent || 0.05; // A

        this.current = 0;
        this.isEnergized = false;
        this.W = 160;
        this.H = 100;
        this.type ='relay';

        this._drawShell();
        this._drawCoil();
        this._drawContact();
        this._createPorts();

        this._startMonitoring();
    }

    // ================= 外壳 =================
    _drawShell() {
        const shell = new Konva.Rect({
            width: this.W,
            height: this.H,
            stroke: "black",
            strokeWidth: 3,
            fill: "#f8f8f8"
        });

        this.group.add(shell);
    }

    // ================= 螺旋线圈 =================
    _drawCoil() {

        const startX = 50;
        const endX = this.W - 50;
        const centerY = 35;
        const turns = 6;
        const amplitude = 10;

        const points = [];

        for (let i = 0; i <= turns * 25; i++) {
            const t = i / (turns * 25);
            const x = startX + (endX - startX) * t;
            const y = centerY + Math.sin(t * turns * Math.PI * 2) * amplitude;
            points.push(x, y);
        }

        this.coilShape = new Konva.Line({
            points,
            stroke: "blue",
            strokeWidth: 2,
            lineCap: "round",
            lineJoin: "round"
        });

        // 线圈两端连线到顶部端子
        this.coilLeftLead = new Konva.Line({
            points: [30, 0, 30, centerY, startX, centerY],
            stroke: "black",
            strokeWidth: 2
        });

        this.coilRightLead = new Konva.Line({
            points: [this.W - 30, 0, this.W - 30, centerY, endX, centerY],
            stroke: "black",
            strokeWidth: 2
        });

        this.group.add(this.coilLeftLead, this.coilRightLead, this.coilShape);
    }

    // ================= 触点 =================
    _drawContact() {

        const contactY = 70;
        // 固定 NO 触点,引线出来30.
        this.noContact = new Konva.Line({
            points: [this.W - 60, contactY, this.W - 30, contactY],
            stroke: "black",
            strokeWidth: 3
        });
        // NO 触点小圆
        this.noDot = new Konva.Circle({
            x: this.W - 60,
            y: contactY,
            radius: 4,
            fill: "black"
        });

        // NO 引线到端子
        this.noLead = new Konva.Line({
            points: [this.W - 30, contactY, this.W - 30, this.H],
            stroke: "black",
            strokeWidth: 2
        });

        // 可动 COM 触点,引线出来30.
        this.comContact = new Konva.Line({
            points: [30, contactY, 60, contactY],
            stroke: "black",
            strokeWidth: 3
        });
        // COM 触点小圆
        this.comDot = new Konva.Circle({
            x: 60,
            y: contactY,
            radius: 4,
            fill: "black"
        });
        // COM 引线
        this.comLead = new Konva.Line({
            points: [30, contactY, 30, this.H],
            stroke: "black",
            strokeWidth: 2
        });

        // ================= 动触臂 =================
        this.armOpenPoints = [60, contactY, 100, contactY + 20];  // 断开
        this.armClosedPoints = [60, contactY, 100, contactY]; // 闭合

        this.arm = new Konva.Line({
            points: this.armOpenPoints,
            stroke: "black",
            strokeWidth: 3,
            lineCap: "round"
        });

        this.group.add(
            this.noContact,
            this.noDot,
            this.noLead,
            this.comContact,
            this.comDot,
            this.comLead,
            this.arm
        );
    }

    // ================= 边缘端子 =================
    _createPorts() {
        this.addPort(30, 0, "l", "wire", "p");
        this.addPort(this.W - 30, 0, "r", "wire");

        this.addPort(30, this.H, "COM", "wire");
        this.addPort(this.W - 30, this.H, "NO", "wire");
    }
    // ================= 自动检测 =================
    _startMonitoring() {
        this.timer = setInterval(() => this._updateElectricalState(), 200);
    }

    _updateElectricalState() {
        if (!this.sys.getVoltageBetween) return;

        const voltage = Math.abs(this.sys.getVoltageBetween(
            `${this.id}_wire_l`,
            `${this.id}_wire_r`
        ));

        if (voltage == null) return;

        // 真实电流计算
        this.current = voltage / this.coilResistance;

        if (!this.isEnergized && this.current >= this.pickupCurrent) {
            this._energize();
        }

        if (this.isEnergized && this.current <= this.releaseCurrent) {
            this._deenergize();
        }

        this._updateCoilVisual();
    }

    // ================= 线圈颜色变化 =================
    _updateCoilVisual() {
        const ratio = Math.min(this.current / this.pickupCurrent, 1);
        const r = Math.floor(255 * ratio);
        this.coilShape.stroke(`rgb(${r},0,255)`);
        const layer = this.group.getLayer() || this.sys.layer;
        if (layer && layer.batchDraw) layer.batchDraw();
    }

    // ================= 吸合动画 =================
    _energize() {
        this.isEnergized = true;

        const startTween = () => {
            if (!this.arm.getLayer()) { setTimeout(startTween, 40); return; }
            new Konva.Tween({ node: this.arm, duration: 0.15, points: this.armClosedPoints, easing: Konva.Easings.EaseInOut }).play();
        };
        startTween();

        this.arm.stroke("red");

        this._notify();
    }

    // ================= 释放动画 =================
    _deenergize() {
        this.isEnergized = false;

        const startTween = () => {
            if (!this.arm.getLayer()) { setTimeout(startTween, 40); return; }
            new Konva.Tween({ node: this.arm, duration: 0.2, points: this.armOpenPoints, easing: Konva.Easings.ElasticEaseOut }).play();
        };
        startTween();

        this.arm.stroke("black");

        this._notify();
    }

    _notify() {
        if (this.sys.onComponentStateChange)
            this.sys.onComponentStateChange(this);
    }

    // ================= 导通逻辑 =================
    isPortConnectedInternally(portA, portB) {
        const a = portA.split('_').pop();
        const b = portB.split('_').pop();

        if (this.isEnergized) {
            return (
                (a === "COM" && b === "NO") ||
                (a === "NO" && b === "COM")
            );
        } else {
            return (
                (a === "COM" && b === "NC") ||
                (a === "NC" && b === "COM")
            );
        }
    }

    destroy() {
        clearInterval(this.timer);
    }
}