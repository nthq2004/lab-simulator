import { BaseComponent } from './BaseComponent.js';

export class Oven extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = config.W || 520;
        this.H = config.H || 360;
        this.title = config.title || '烘箱';
        this.init();
    }

    init() {
        // 烘箱外壳
        const shell = new Konva.Rect({
            x: 0,
            y: 0,
            width: this.W,
            height: this.H,
            fill: '#f7f3e9',
            stroke: '#555',
            strokeWidth: 2,
            cornerRadius: 6,
            shadowColor: '#000',
            shadowBlur: 6,
            shadowOpacity: 0.15
        });

        // 标题栏
        const titleBar = new Konva.Text({
            x: this.W/2-8,
            y: this.H-16,
            text: this.title,
            fontSize: 16,
            fontStyle: 'bold',
            fill: '#333'
        });

        // 将外壳和标题放入组，注意 BaseComponent 构造时 group 已设置位置
        this.group.add(shell, titleBar);

        // 使烘箱可拖拽（BaseComponent 已默认 draggable:true）
        // 当烘箱移动时，Konva 会自动把内部子节点一起移动
    }

    // 将组件固定放入烘箱内部，坐标为相对烘箱左上角的偏移
    addInside(component, relX = 0, relY = 0) {
        // 如果组件已在别的父容器中，先从父容器安全移除
        const prevParent = component.group.getParent();
        if (prevParent) {
            // 保留视觉上的位置计算：先获得绝对位置，再转换为相对烘箱坐标
            const abs = component.group.getAbsolutePosition();
            // 将组件从原父中移除
            component.group.remove();
            // 计算相对于烘箱的位置（烘箱 group 的绝对位置）
            const ovenAbs = this.group.getAbsolutePosition();
            relX = Math.round(abs.x - ovenAbs.x);
            relY = Math.round(abs.y - ovenAbs.y);
        }

        component.group.x(relX);
        component.group.y(relY);
        // 默认禁止拖拽整个子组件（但内部控件仍可响应事件）
        component.group.draggable(false);
        this.group.add(component.group);
    }
}

export default Oven;
