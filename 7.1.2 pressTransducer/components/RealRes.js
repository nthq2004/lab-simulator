import { BaseComponent } from './BaseComponent.js'; // 假设路径

export class RealResistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'resistor';
        this.value = config.value || 250; // 默认 1kΩ
        this.currentResistance = this.value;
        // 新增：误差属性，默认 5% (金色)
        this.tolerance = config.tolerance || 1;

        this.config ={'id':this.id,'tolerance':this.tolerance,'currentResistance':this.currentResistance};

        // 颜色映射表
        this.colorMap = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'white'];

        // 误差颜色对照表
        this.toleranceMap = {
            1: 'brown',
            2: 'red',
            5: 'gold',
            10: 'silver'
        };

        // 1. 绘制引脚（金属丝效果）
        const leadL = new Konva.Line({
            points: [-60, 0, -20, 0],
            stroke: '#bdc3c7',
            strokeWidth: 2,
            lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [20, 0, 60, 0],
            stroke: '#bdc3c7',
            strokeWidth: 2,
            lineCap: 'round'
        });

        // 2. 绘制电阻主体（类似图片中的圆柱收腰造型）
        // 使用 Path 绘制带弧度的轮廓
        const body = new Konva.Path({
            data: 'M -22 -8 L 22 -8 Q 28 -8 28 0 Q 28 8 22 8 L -22 8 Q -28 8 -28 0 Q -28 -8 -22 -8 Z',
            fill: '#d1d1d1', // 哑光灰色
            stroke: '#95a5a6',
            strokeWidth: 1,
            shadowColor: 'black',
            shadowBlur: 5,
            shadowOffset: { x: 2, y: 2 },
            shadowOpacity: 0.2
        });

        this.group.add(leadL, leadR, body);

        // 3. 动态添加色环
        this.drawBands();

        // 4. 添加电气端口（左端 l，右端 r）
        // 使用基类的 addPort 方法，自动处理交互和连线 ID
        this.addPort(-60, 0, 'l', 'wire');
        this.addPort(60, 0, 'r', 'wire');

        // 如果需要显示数值文字
        this.label = new Konva.Text({
            text: `${this.currentResistance} Ω (±${this.tolerance}%)`,
            x: -25,
            y: 15,
            fontSize: 12,
            fill: '#2c3e50',
            align: 'center',
            width: 50
        });
        this.group.add(this.label);
    }

    /**
     * 根据阻值计算色环并绘制
     */
    drawBands() {
        const colors = this.calculateColorBands(this.currentResistance);
        const bandX = [-18, -8, 2, 15]; // 色环分布位置

        colors.forEach((color, i) => {
            const band = new Konva.Rect({
                x: bandX[i],
                y: -8,
                width: 5,
                height: 16,
                fill: color,
                opacity: 0.9,
                stroke: 'rgba(0,0,0,0.1)',
                strokeWidth: 0.5
            });
            this.group.add(band);
        });
    }

    calculateColorBands(value) {
        // 4环逻辑
        let sigFigs;
        let exponent;

        if (value < 10) {
            sigFigs = (value * 10).toString().padStart(2, '0');
            exponent = -1; // 金色倍率环 (暂简化处理为 0)
        } else {
            const str = Math.floor(value).toString();
            sigFigs = str.substring(0, 2);
            exponent = str.length - 2;
        }

        const first = parseInt(sigFigs[0]);
        const second = parseInt(sigFigs[1]);

        // 前三环：有效数字1，有效数字2，倍率
        // 第四环：误差
        return [
            this.colorMap[first],
            this.colorMap[second],
            this.colorMap[exponent] || 'black',
            this.toleranceMap[this.tolerance] || 'gold'
        ];
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阻值 (Ω)', key: 'currentResistance', type: 'number' },
            {
                label: '误差 (%)',
                key: 'tolerance',
                type: 'select',
                options: [
                    { label: '1% (棕)', value: 1 },
                    { label: '2% (红)', value: 2 },
                    { label: '5% (金)', value: 5 },
                    { label: '10% (银)', value: 10 }
                ]
            }
        ];
    }

    onConfigUpdate(newConfig) {
        this.currentResistance = parseFloat(newConfig.currentResistance);
        this.tolerance = parseInt(newConfig.tolerance);

        // 彻底重绘以更新色环颜色和标签
        this.drawBands();
        this.label.text(`${this.currentResistance} Ω (±${this.tolerance}%)`);
    }
    // 获取电阻值供仿真引擎调用
    getValue() {
        return this.currentResistance;
    }
}