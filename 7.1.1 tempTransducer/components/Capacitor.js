import { BaseComponent } from './BaseComponent.js';

export class Capacitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 基础物理参数
        this.type = 'capacitor';
        this.capacitance = config.capacitance || 100e-6; 
        this.vLast = 0;       
        this.physCurrent = 0; 
        
        this.config = { id: this.id, capacitance: this.capacitance };

        this.initVisuals();
        
        // 引脚从下方引出，位置与引线末端对齐
        // 左长脚 (正), 右短脚 (负)
        this.addPort(-15, 60, 'l', 'wire'); 
        this.addPort(15, 45, 'r', 'wire');  
    }

    initVisuals() {
        const colors = {
            body: '#2c3e50',      // 深色工业壳体
            stripe: '#bdc3c7',    // 负极灰色指示条
            lead: '#aeb6bf',      // 金属引脚
            top: '#566573',       // 顶部防爆槽
            text: '#ecf0f1'
        };

        // 1. 绘制引脚 (从主体底部延伸)
        // 左侧长引脚
        const leadL = new Konva.Line({
            points: [-15, 20, -15, 60],
            stroke: colors.lead,
            strokeWidth: 3,
            lineCap: 'round'
        });
        // 右侧短引脚
        const leadR = new Konva.Line({
            points: [15, 20, 15, 45],
            stroke: colors.lead,
            strokeWidth: 3,
            lineCap: 'round'
        });

        // 2. 电容主体 (柱状)
        this.body = new Konva.Rect({
            x: -25, y: -40,
            width: 50, height: 65,
            fill: colors.body,
            cornerRadius: 5,
            stroke: '#1a252f',
            strokeWidth: 2
        });

        // 3. 负极指示条 (位于右侧)
        const negBar = new Konva.Rect({
            x: 10, y: -40,
            width: 15, height: 65,
            fill: colors.stripe,
            cornerRadius: [0, 5, 5, 0],
            opacity: 0.8
        });

        // 在负极条上绘制 "-" 符号
        const minusSign = new Konva.Text({
            x: 10, y: -10,
            text: '-',
            fontSize: 24,
            fontStyle: 'bold',
            fill: '#2c3e50',
            width: 15,
            align: 'center'
        });

        // 4. 顶部防爆凹槽
        const topCap = new Konva.Line({
            points: [-20, -32, 20, -32],
            stroke: colors.body,
            strokeWidth: 1,
            opacity: 0.5
        });

        // 5. 容量标注
        this.label = new Konva.Text({
            x: -25, y: -20,
            text: this.formatCapacitance(this.capacitance),
            fontSize: 11,
            fontStyle: 'bold',
            fill: colors.text,
            align: 'center',
            width: 50
        });

        this.group.add(leadL, leadR, this.body, negBar, minusSign, topCap, this.label);
    }

    formatCapacitance(farads) {
        if (farads >= 1) return farads.toFixed(1) + 'F';
        if (farads >= 1e-3) return (farads * 1e3).toFixed(1) + 'mF';
        if (farads >= 1e-6) return (farads * 1e6).toFixed(1) + 'uF';
        if (farads >= 1e-9) return (farads * 1e9).toFixed(1) + 'nF';
        return (farads * 1e12).toFixed(1) + 'pF';
    }

    /**
     * MNA 伴随模型参数
     */
    getCompanionModel(deltaTime) {
        // G = C / dt
        const gEq = this.capacitance / deltaTime;
        // Ieq = G * Vlast
        const iEq = gEq * this.vLast;
        return { gEq, iEq };
    }

    /**
     * 更新上一时间步状态
     */
    updateState(vL, vR) {
        this.vLast = vL - vR;
    }

    /**
     * 计算并定格物理电流 (I = C * dv/dt)
     */
    calculatePhysicalCurrent(vL, vR, deltaTime) {
        if (deltaTime <= 0) return 0;
        const gEq = this.capacitance / deltaTime;
        this.physCurrent = gEq * ((vL - vR) - this.vLast);
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '电容值 (F)', key: 'capacitance', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.capacitance = parseFloat(newConfig.capacitance);
        this.label.text(this.formatCapacitance(this.capacitance));
        this.sys.redrawAll();
    }
}