import { BaseComponent } from './BaseComponent.js';

export class RealVariResistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 基础参数
        this.type = 'resistor';
        this.totalResistance = config.totalResistance || 10000;
        this.currentResistance =0;
        this.currentDeg = config.angle || 0;
        this.maxAngle = 270;

        this.config = { id: this.id, totalResistance: this.totalResistance };

        this.initVisuals();
        this.updateResistors();

        // 保持端点在下方一排，方便接线
        this.addPort(-30, 60, 'l', 'wire'); // 左固定端
        this.addPort(0, 60, 'r', 'wire');   // 滑动端（中间）
        // this.addPort(30, 60, 'C', 'wire');  // 右固定端
    }

    initVisuals() {
        // --- 深沉工业色调定义 ---
        const colors = {
            track: '#2c3e50',      // 深灰蓝轨道
            trackStroke: '#1a252f',
            knob: '#dbe2e2',       // 深灰色旋钮
            knobStroke: '#34495e',
            pointer: '#c0392b',    // 暗红色指针
            leads: '#5d6d7e'       // 金属引线颜色
        };

        // 1. 内部逻辑引线：将下方的端口位置连接到上方的核心部件
        // 从 A 端口引向轨道左起点
        this.title = new Konva.Text({
            x: -40, y:-58,
            text: `${(this.totalResistance/2000).toFixed(2)} kΩ` ,
            fontSize: 12,
            fontStyle: 'bold',
            align:'center',
            width:80
            
        });
        const internalLeadA = new Konva.Line({
            points: [-30, 60, -30, 45, -25, 25],
            stroke: colors.leads,
            strokeWidth: 4,
            lineJoin: 'round',
            tension: 0.2
        });
        // 从 C 端口引向轨道右起点
        const internalLeadC = new Konva.Line({
            points: [30, 60, 30, 45, 25, 25],
            stroke: colors.leads,
            strokeWidth: 4,
            lineJoin: 'round',
            tension: 0.2
        });
        // 从 B 端口引向旋转中心
        const internalLeadB = new Konva.Line({
            points: [0, 60, 0, 0],
            stroke: colors.leads,
            strokeWidth: 4,
            dash: [4, 2] // 滑动端使用虚线表示内部连接
        });

        // 2. 绘制外壳轨道 (C型深色碳膜)
        this.track = new Konva.Arc({
            innerRadius: 35,
            outerRadius: 45,
            angle: 270,
            fill: colors.track,
            stroke: colors.trackStroke,
            strokeWidth: 3,
            rotation: 135,
            lineJoin: 'round'
        });
        //  动态轨道轨道 (随滑动改变角度)
        this.fTrack = new Konva.Arc({
            innerRadius: 35,
            outerRadius: 45,
            angle: 135,
            fill: colors.pointer,
            stroke: colors.trackStroke,
            strokeWidth: 3,
            rotation: 135,
            lineJoin: 'round'
        });
        // 3. 绘制旋转旋钮
        this.knobGroup = new Konva.Group({
            x: 0,
            y: 0,
            rotation: this.angle,
            draggable: true
        });

        const knobCircle = new Konva.Circle({
            radius: 30,
            fill: colors.knob,
            stroke: colors.knobStroke,
            strokeWidth: 2,
            shadowBlur: 8,
            shadowColor: 'black',
            shadowOpacity: 0.4
        });

        // 更粗、颜色更深沉的指针
        const pointer = new Konva.Line({
            points: [0, -10, 0, -38],
            stroke: colors.pointer,
            strokeWidth: 10,
            lineCap: 'round'
        });

        // 中心装饰盖（轴心）
        const centerCap = new Konva.Circle({
            radius: 6,
            fill: colors.trackStroke
        });
        //为了仿真方便，C端口不引出
        const cPort = new Konva.Circle({ x: 30, y: 60, radius: 6, fill: '#dee2e7', stroke: '#b3b6b9', strokeWidth: 1, });
        this.knobGroup.add(knobCircle, pointer, centerCap);

        // --- 交互与旋转逻辑 ---
        this.knobGroup.on('dragmove', (e) => {
            // 锁定平移，强制只计算旋转
            this.knobGroup.position({ x: 0, y: 0 });
            const pos = this.sys.stage.getPointerPosition();
            const groupPos = this.group.getAbsolutePosition();

            // 计算鼠标相对于中心的角度 (-180 到 180)
            let deg = Math.atan2(pos.y - groupPos.y, pos.x - groupPos.x) * 180 / Math.PI;

            // 此时 deg=90 是正下方。我们需要将其映射到旋转空间。
            // 我们的有效范围是 -135 (左下) -> 0 (正上) -> 135 (右下)

            // 处理死区 (开口向下，即 45 到 135 之间的范围)
            // 如果角度在 45 到 90 之间，说明靠近左侧极限，锁死在 135
            // 如果角度在 90 到 135 之间，说明靠近右侧极限，锁死在 -135 (注意 atan2 的跳转)

            // 逻辑简化：如果角度在 45 到 135 之间（正下方区域）
            if (deg > 45 && deg < 135) {
                if (deg > 90) {
                    deg = 135; // 限制在右下终点
                } else {
                    deg = 45; // 这个区域理论上不应该直接跳，但在 -135 到 135 坐标系下需要换算
                }
            }

            // 实际上，为了最稳妥的 -135 到 135 限制：
            let finalDeg = deg + 90; // 将正上方设为 0 度
            if (finalDeg > 180) finalDeg -= 360;
            if (finalDeg < -180) finalDeg += 360;

            // 限制范围
            if (finalDeg < -135) finalDeg = -135;
            if (finalDeg > 135) finalDeg = 135;

            this.currentDeg = finalDeg;
            this.knobGroup.rotation(this.currentDeg);
            this.fTrack.angle(this.currentDeg + 135);
            this.updateResistors();
            this.title.text(`${(this.currentResistance/1000).toFixed(2)} kΩ`);
            this.sys.redrawAll();
        });

        // 组合所有元素
        this.group.add(this.title,internalLeadA, internalLeadC, this.track, this.fTrack, this.knobGroup, internalLeadB, cPort);
    }

    updateResistors() {
        const ratio = this.currentDeg / this.maxAngle + 0.5;
        this.currentResistance = this.totalResistance * ratio;

        // 仿真稳定性处理
        this.currentResistance = Math.max(this.totalResistance *0.01, this.currentResistance);

    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '总阻值 (Ω)', key: 'totalResistance', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.totalResistance = newConfig.totalResistance;
        this.updateResistors();
        this.sys.layer.draw();
    }
}