import { BaseComponent } from './BaseComponent.js';

export class TPipe extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.w = 60;
        this.h = 60;
        this.direction = config.direction;

        // 1. 绘制 T 型管本体图形
        // 使用较粗的线条表现管径，并绘制 T 字交叉感
        const tShape = new Konva.Line({
            // 定义 T 字型的路径：左中 -> 右中，以及中心点 -> 下中
            points: [
                0, 30,    // 左
                60, 30,   // 右
                30, 30,   // 中心点
                30, 60    // 下
            ],
            stroke: '#accccf',
            strokeWidth: 25,
            lineCap: 'round',
            lineJoin: 'round'
        });

        // 2. 绘制中心加固焊缝效果（可选，增强工业感）
        const joint = new Konva.Circle({
            x: 30,
            y: 30,
            radius: 10,
            fill: '#95a5a6',
            stroke: '#7f8c8d',
            strokeWidth: 1
        });

        // 3. 添加组件名称文本
        const label = new Konva.Text({
            x: -20,
            y: 0,
            width: 100,
            text: 'T型接头',
            fontSize: 18,
            align: 'center',
            fill: '#2c3e50',
            fontStyle: 'bold'
        });

        // 将图形添加到组件组
        this.group.add(tShape, joint, label);

        // 4. 定义三个端口（基于管路逻辑）
        // 这里根据你之前的 autoPipe 映射定义：
        // in: 左侧输入, r: 右侧输出, b: 下方输出
        this.addPort(-10, 30, 'r', 'pipe');  // 来自水泵
        this.addPort(70, 30, 'l', 'pipe');   // 去往调节阀 (直通路)
        this.addPort(30, 70, 'u', 'pipe');   // 去往冷却器 (分支路)

        if (this.direction === 'down') {
        } else if (this.direction === 'up') {
            this.group.rotation(180); // 整体旋转180度，接口位置不变但方向相反
        } else if (this.direction === 'left') {
            this.group.rotation(90); // 整体旋转-90度，接口位置不变但方向相反
        } else if (this.direction === 'right') {
            this.group.rotation(-90); // 整体旋转90度，接口位置不变但方向相反
        }
    }

    /**
     * T型管通常没有动态动画，但可以预留接口用于显示压力或流量颜色
     * @param {number} flowRate 流量比
     */
    update(flowRate) {
        // 如果需要，可以根据是否有水流改变端口颜色或发光效果
        const portColor = flowRate > 0 ? '#3498db' : '#7f8c8d';
        this.ports.forEach(p => p.node.fill(portColor));
    }
}