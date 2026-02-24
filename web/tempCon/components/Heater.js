import { BaseComponent } from "./BaseComponent.js";

export class Heater extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 标准尺寸
        this.W = 160;
        this.H = 200;

        // ===== 核心状态 =====
        this.mode = "local";    // "local" 或 "remote"
        this.running = false;   // 运行开关状态
        this.power = 0;         // 实际物理输出/视觉亮度 (0-1)
        this.targetPower = 0;   // 目标功率 (0-1)

        // ===== 初始化绘制 =====
        this._drawShell();
        this._drawPowerInput();
        this._drawTopPanel();
        this._drawHeater();
        this._createPorts();

        // 不再启动内部 Animation 循环，等待主程序通过 update() 驱动
    }

    /**
     * 核心受控更新函数
     * @param {number} pwm - 远程模式下的输入功率 (0-1)
     * @param {number} dt - 主程序传入的两帧间隔时间 (秒)
     */
    update(pwm, dt = 0.016) {
        // 1. 模式逻辑处理
        if (this.mode === "remote") {
            this.targetPower = Math.max(0, Math.min(1, pwm || 0));
            this.running = this.targetPower > 0.01;
        } else {
            // 本地模式：targetPower 由点击事件直接控制为 1.0 或 0
        }

        // 2. 模拟热惯性 (物理平滑)
        // 升温系数(0.5)，降温系数(0.2)，模拟加热丝冷却慢的特性
        const inertia = this.targetPower > this.power ? 0.5 : 0.2;
        // 使用 dt 进行增量计算，确保动画速度与帧率无关
        this.power += (this.targetPower - this.power) * inertia * dt * 10;
        
        // 边界修正
        if (this.power < 0.001) this.power = 0;
        if (this.power > 0.999) this.power = 1;

        // 3. 执行视觉渲染
        this._renderVisuals();
    }

    /**
     * 视觉刷新逻辑
     * 仅修改现有 Konva 节点的属性，不创建新节点
     */
    _renderVisuals() {
        // A. 颜色计算：暗灰(#3a3a3a) -> 亮红 -> 橙黄
        const r = Math.floor(58 + (255 - 58) * this.power);
        // 功率超过 70% 时，增加绿色通道，颜色由红转橙
        const g = this.power > 0.7 ? Math.floor((this.power - 0.7) * 400) : 0;
        const color = `rgb(${r}, ${Math.min(220, g)}, 0)`;

        // B. 更新加热丝
        this.coils.forEach((coil) => {
            coil.stroke(color);
            // 提示：若 100ms 延迟持续存在，请尝试注释掉下面两行阴影代码
            coil.shadowBlur(this.power * 15);
            coil.shadowOpacity(this.power * 0.8);
        });

        // C. 更新控制面板按钮灯光
        this.startBtn.fill(this.running ? "#00ff00" : "#0da30d");
        this.stopBtn.fill(!this.running ? "#ff0000" : "#9a0f0f");
        
        // 按钮发光反馈
        this.startBtn.shadowOpacity(this.running ? 0.6 : 0);
        this.stopBtn.shadowOpacity(!this.running ? 0.6 : 0);
    }

    _drawShell() {
        this.group.add(new Konva.Rect({
            width: this.W,
            height: this.H,
            stroke: "#333",
            strokeWidth: 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.W, y: this.H },
            fillLinearGradientColorStops: [0, '#e8e8e8', 1, '#bcbcbc'],
            cornerRadius: 4,
            shadowBlur: 8,
            shadowOpacity: 0.2
        }));
    }

    _drawPowerInput() {
        const inputGroup = new Konva.Group({ x: 0, y: 10 });
        const colors = ["#8B4513", "#4169E1"];
        [1, 2].forEach((i) => {
            const lineY = i * 15;
            inputGroup.add(new Konva.Line({
                points: [-25, lineY, 0, lineY],
                stroke: "#555",
                strokeWidth: 3
            }));
            inputGroup.add(new Konva.Circle({
                x: 0, y: lineY, radius: 4,
                fill: colors[i - 1], stroke: "#333", strokeWidth: 1
            }));
            inputGroup.add(new Konva.Text({
                x: 5, y: lineY - 5,
                text: i === 1 ? "L" : "N",
                fontSize: 9, fill: "#666", fontStyle: "bold"
            }));
        });
        this.group.add(inputGroup);
    }

    _drawTopPanel() {
        // 面板背景
        this.group.add(new Konva.Rect({
            width: this.W,
            height: 60,
            fill: "#cfcfcf",
            stroke: "#333",
            strokeWidth: 1,
            cornerRadius: { topLeft: 4, topRight: 4 }
        }));

        // 模式切换文字
        const selectorGroup = new Konva.Group({ x: 35, y: 32 });
        selectorGroup.add(new Konva.Text({ x: -22, y: -24, text: "LOC", fontSize: 9, fontStyle: 'bold' }));
        selectorGroup.add(new Konva.Text({ x: 8, y: -24, text: "REM", fontSize: 9, fontStyle: 'bold' }));

        // 旋钮
        this.knob = new Konva.Group({ cursor: 'pointer' });
        this.knob.add(new Konva.Circle({
            radius: 14,
            fillLinearGradientColorStops: [0, '#666', 1, '#111'],
            stroke: "#000", strokeWidth: 1
        }));
        this.knob.add(new Konva.Rect({ x: -2, y: -14, width: 4, height: 14, fill: "#fff", cornerRadius: 1 }));
        
        // 设置初始角度
        this.knob.rotation(this.mode === "local" ? -45 : 45);

        this.knob.on("click", () => {
            this.mode = this.mode === "local" ? "remote" : "local";
            this.targetPower = 0; // 切换时重置状态
            this.running = false;
            this._updateSelectorUI();
        });
        selectorGroup.add(this.knob);
        this.group.add(selectorGroup);

        // 控制按钮
        const btnY = 32;
        this.startBtn = new Konva.Circle({
            x: 95, y: btnY, radius: 14,
            fill: "#0a810a", stroke: "#000", strokeWidth: 2,
            shadowColor: "#00ff00", cursor: 'pointer'
        });
        this.startBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = true;
                this.targetPower = 1.0;
                this.startBtn.y(btnY + 2);
            }
        });
        this.startBtn.on("mouseup mouseleave", () => this.startBtn.y(btnY));

        this.stopBtn = new Konva.Circle({
            x: 135, y: btnY, radius: 14,
            fill: "#871212", stroke: "#000", strokeWidth: 2,
            shadowColor: "#ff0000", cursor: 'pointer'
        });
        this.stopBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = false;
                this.targetPower = 0;
                this.stopBtn.y(btnY + 2);
            }
        });
        this.stopBtn.on("mouseup mouseleave", () => this.stopBtn.y(btnY));

        this.group.add(this.startBtn, this.stopBtn);
    }

    _updateSelectorUI() {
        const targetAngle = this.mode === "local" ? -45 : 45;
        // 安全 Tween 播放
        if (this.knob.getLayer()) {
            new Konva.Tween({ node: this.knob, duration: 0.15, rotation: targetAngle }).play();
        } else {
            this.knob.rotation(targetAngle);
        }
    }

    _drawHeater() {
        const centerX = this.W / 2;
        const centerY = 130;

        // 加热底座
        this.group.add(new Konva.Circle({
            x: centerX, y: centerY, radius: 55,
            fill: "#222", stroke: "#444", strokeWidth: 2
        }));

        this.coils = [];
        // 绘制 5 圈同心圆加热丝
        for (let i = 0; i < 5; i++) {
            const coil = new Konva.Circle({
                x: centerX,
                y: centerY,
                radius: 12 + i * 9,
                stroke: "#3a3a3a",
                strokeWidth: 4,
                shadowColor: "red"
            });
            this.coils.push(coil);
            this.group.add(coil);
        }
    }

    _createPorts() {
        // 复用 BaseComponent 的接口
        this.addPort(50, 0, "l", "wire");
        this.addPort(110, 0, "r", "wire");
    }

    destroy() {
        super.destroy();
    }
}