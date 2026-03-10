import { BaseComponent } from './BaseComponent.js';

export class PneumaticValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 原始尺寸是 340x700，缩小 2/3 约为 226x466
        this.w = 226; 
        this.h = 466;
        this.scale = 0.8;
        this.type = 'PRECISION_VALVE';

        // 核心物理状态 (保持原始像素逻辑，依靠 scale 映射视觉)
        this.travel = 0; 
        this.targetTravel = 0;
        this.strokePx = 65; 

        this.initVisuals();

        // 信号端口 (坐标也需要按 2/3 调整)
        this.addPort(-10, 206, 'sig_in', 'wire', 'p');
        this.addPort(-10, 230, 'sig_gnd', 'wire');

        this._startLoop();
    }

    initVisuals() {
        // 创建一个内部容器，统一缩放 2/3 (0.666)
        const scaleGroup = new Konva.Group({
            scaleX: this.scale,
            scaleY: this.scale
        });
        this.group.add(scaleGroup);

        const cx = 340 / 2; // 使用原始中心点计算

        // --- 1. 气室外壳 ---
        const housing = new Konva.Path({
            x: cx, y: 100,
            data: `M -140 -20 L 140 -20 L 140 0 L 155 0 L 155 10 L 140 10 L 140 50 L 100 50 L 100 86 L 33 86 L 33 240 L -33 240 L -33 86 L -100 86 L -100 50 L -140 50 L -140 10 L -155 10 L -155 0 L -140 0 Z`,
            fill: '#f0f0f0', stroke: '#444', strokeWidth: 10
        });

        // --- 2. 膜片悬挂系统 ---
        this.leftWireL = new Konva.Line({ points: [-150, 5, -108, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.leftWire = new Konva.Line({ points: [-108, 5, -100, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.rightWire = new Konva.Line({ points: [108, 5, 100, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        this.rightWireR = new Konva.Line({ points: [150, 5, 108, 5], stroke: '#0d0ddd', strokeWidth: 3, x: cx, y: 100 });
        
        this.membrane = new Konva.Rect({
            x: cx - 100, y: 100, width: 200, height: 15,
            fill: '#0d0ddd', cornerRadius: 2
        });

        this.spring = new Konva.Line({
            x: cx, y: 115, points: this._getSpringPoints(225),
            stroke: '#087b16', strokeWidth: 6, lineJoin: 'round'
        });

        // --- 3. 支架与定位器 ---
        const yoke = new Konva.Path({
            x: cx, y: 350,
            data: `M -3 0 L -55 0 Q -85 0 -85 30 L -85 170 Q -85 200 -55 200 L 55 200 Q 85 200 85 170 L 85 30 Q 85 0 55 0 L 3 0`,
            stroke: '#2b2fae', strokeWidth: 12, lineCap: 'round', lineJoin: 'round'
        });

        this.posBox = new Konva.Group({ x: cx - 120, y: 368 });
        this.posBox.add(new Konva.Rect({ width: 85, height: 110, fill: '#2c2c2c', cornerRadius: 4 }));
        this.lcd = new Konva.Text({ x: 10, y: 25, text: '0.0%', fontSize: 15, fill: '#33ff33', fontFamily: 'Courier New' });
        this.posBox.add(this.lcd);

        // --- 4. 阀体 ---
        const valveBaseY = 556;
        this.valveGroup = new Konva.Group({ x: cx, y: valveBaseY });
        const bodyShell = new Konva.Rect({ x: cx-290, y: 0, width: 240, height: 160, fill: '#b0afae', stroke: '#0f3bd9' });
        const pipe = new Konva.Rect({ x: cx-300, y: 30, width: 260, height: 65, fill: '#c3c1f9', stroke: '#ced7f8' });
        this.valveGroup.add(bodyShell, pipe);

        // --- 5. 阀杆与阀芯 ---
        this.stem = new Konva.Rect({ x: cx - 4, y: 115, width: 8, height: 472, fill: '#eee', stroke: '#999' });
        this.plug = new Konva.Path({
            x: cx, y: 587,
            data: 'M -22 0 L 22 0 Q 22 65, 0 65 Q -22 65, -22 0 Z',
            fill: '#1a1a1a'
        });
        
        this.coupling = new Konva.Group({ x: cx, y: 350 });
        this.coupling.add(new Konva.Rect({ x: -15, y: 0, width: 30, height: 45, fill: '#444', cornerRadius: 3 }));
        this.coupling.add(new Konva.Rect({ x: -18, y: 15, width: 36, height: 15, fill: '#222' }));

        // --- 6. 填料函 ---
        this.packingBox = new Konva.Group({ x: cx - 20, y: 510 });
        this.packingBox.add(new Konva.Rect({ width: 40, height: 60, fill: '#e0e0e0', stroke: '#333' }));
        this.packingBox.add(new Konva.Path({
            data: 'M 0 10 L 40 20 M 0 20 L 40 30 M 0 30 L 40 40 M 0 40 L 40 50 M 0 50 L 40 60 M 0 60 L 40 70',
            stroke: '#999', strokeWidth: 1
        }));

        // 将所有元素添加到缩放组中
        scaleGroup.add(yoke, housing, this.leftWireL, this.leftWire, this.rightWire, this.rightWireR, this.spring, this.valveGroup, this.packingBox, this.stem, this.plug, this.coupling, this.membrane, this.posBox);
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -28 : 28, (i / coils) * h);
        }
        return pts;
    }

    update(inputmA) {
        const mA = (typeof inputmA === 'number') ? Math.max(4, Math.min(20, inputmA)) : 4;
        this.targetTravel = (mA - 4) / 16;

        this.travel += (this.targetTravel - this.travel) * 0.15;
        const currentMove = this.travel * this.strokePx;

        // 动画逻辑保持不变（作用于原始坐标，由 scaleGroup 自动处理视觉缩小）
        this.membrane.y(100 + currentMove);
        this.leftWire.points([-108, 5, -100, 5 + currentMove]);
        this.rightWire.points([108, 5, 100, 5 + currentMove]);
        this.spring.y(115 + currentMove);
        this.spring.points(this._getSpringPoints(225 - currentMove));
        this.stem.y(115 + currentMove);
        this.plug.y(587 + currentMove);

        this.lcd.text(`${mA.toFixed(1)}mA\n${(this.travel * 100).toFixed(1)}%`);
        // const brightness = 220 - (this.travel * 100);
        // this.valveGroup.findOne('Path').fill(`rgb(${brightness},${brightness},${brightness})`);
    }

    _startLoop() { }
}