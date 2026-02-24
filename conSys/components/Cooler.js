import { BaseComponent } from './BaseComponent.js';

export class Cooler extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.w = 300;
        this.h = 120;

        // 1. 大外壳（主体矩形 + 两端半球端盖）
        const body = new Konva.Rect({ x: 30, y: 10, width: this.w - 60, height: this.h - 20, fill: '#f6f6f4', stroke: '#2c3e50', strokeWidth: 3, cornerRadius: 8 });
        const leftCap = new Konva.Ellipse({ x: 30, y: this.h / 2, radius: { x: 30, y: this.h / 2 - 6 }, fill: '#7a7e82' });
        const rightCap = new Konva.Ellipse({ x: this.w - 30, y: this.h / 2, radius: { x: 30, y: this.h / 2 - 6 }, fill: '#8a8d8f' });
        const shellFace = new Konva.Rect({ x: 34, y: 14, width: this.w - 68, height: this.h - 28, fill: '#ffffff', stroke: null, cornerRadius: 6 });

        // 3. 侧面进出法兰与箭头
        const flangeL = new Konva.Rect({ x: 6, y: this.h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
        const flangeR = new Konva.Rect({ x: this.w - 26, y: this.h / 2 + 10, width: 20, height: 20, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
        const seaIn = new Konva.Arrow({ points: [16, this.h / 2 + 20, -16, this.h / 2 + 20], stroke: '#e74c3c', fill: '#e74c3c', strokeWidth: 4, pointerLength: 10, pointerWidth: 8 });
        const seaOut = new Konva.Arrow({ points: [this.w + 16, this.h / 2 + 20, this.w - 16, this.h / 2 + 20], stroke: '#3498db', fill: '#3498db', strokeWidth: 4, pointerLength: 10, pointerWidth: 8 });

        // 标题文本
        const title = new Konva.Text({ x: 0, y: -10, width: this.w, text: '淡水冷却器', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });

        this.group.add(body, leftCap, rightCap, shellFace, flangeL, flangeR, seaIn, seaOut, title);

        // 2. 绘制内部蛇形换热管 (黄色)
        const pipePoints = [];
        const startX = 60;
        const endX = this.w - 60;
        const rows = 6;
        const gapY = (this.h - 40) / (rows - 1);
        for (let i = 0; i < rows; i++) {
            const y = 20 + i * gapY;
            if (i % 2 === 0) {
                pipePoints.push(startX, y, endX, y);
            } else {
                pipePoints.push(endX, y, startX, y);
            }
        }
        // 绘制为多段黄色线（带圆头）
        for (let i = 0; i < pipePoints.length; i += 4) {
            const line = new Konva.Line({ points: [pipePoints[i], pipePoints[i + 1], pipePoints[i + 2], pipePoints[i + 3]], stroke: '#f1c40f', strokeWidth: 6, lineCap: 'round', lineJoin: 'round' });
            this.group.add(line);
        }

        // 在管路上绘制流向箭头（浅蓝色）
        for (let i = 0; i < rows; i++) {
            const y = 20 + i * gapY;
            const fromX = (i % 2 === 0) ? startX + 10 : endX - 10;
            const toX = (i % 2 === 0) ? endX - 10 : startX + 10;
            const arrow = new Konva.Arrow({ points: [fromX, y, toX, y], stroke: '#2eccf3', fill: '#2eccf3', strokeWidth: 2, pointerLength: 8, pointerWidth: 6 });
            this.group.add(arrow);
        }

        // 4. 被冷却淡水管束 (黄色 S 型流道效果)
        this.tubeFlows = new Konva.Group();
        const rowCount = 4;
        const startX2 = 70, endX2 = this.w - 70;
        for (let i = 0; i < rowCount; i++) {
            const y = 30 + i * 20;
            const tube = new Konva.Line({
                points: [startX2, y, endX2, y],
                stroke: '#f1c40f', strokeWidth: 4,
                opacity: 0.6
            });
            // 内部流动的淡水虚线（向右流）
            const flow = new Konva.Line({
                points: [startX2, y, endX2, y],
                stroke: '#fff', strokeWidth: 2,
                dash: [10, 15],
                name: 'fw_flow'
            });
            this.tubeFlows.add(tube, flow);
        }


        this.group.add(this.tubeFlows);

        //  定义端口（保持与系统匹配）。位置放在左右法兰中心
        this.addPort(6 + 10, this.h / 2 - 20, 'in', 'pipe');   // 海水入口
        this.addPort(this.w - 6 - 10, this.h / 2 - 20, 'out', 'pipe'); // 海水出口
    }

    /**
         * @param {number} load 流量系数 (0-1)
         */
    update(load) {
        // 1. 海水流动动画 (始终向左移动，模拟冷却介质)

        // 2. 淡水流动动画 (根据系统状态移动)
        const isFlowing = load > 0.05;
        if (isFlowing) {
            this.tubeFlows.find('.fw_flow').forEach(line => {
                line.visible(true);
                // 向右流动，速度与 load 相关
                line.dashOffset(line.dashOffset() - (1 + load * 5));
                line.opacity(0.1 + load * 0.8);
            });
        }
    }

}