import { BaseComponent } from './BaseComponent.js';

export class TeeConnector extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 1. 设置缩放与尺寸
        this.scale = config.scale || 1;
        // 三通通常是正方形占据空间
        this.w = 100 * this.scale;
        this.h = 100 * this.scale;

        this.type = 'teeConnector';
        this.direction = config.direction || 'up'; // up, down, left, right

        this.colors = {
            body: '#c1bcbc',      // 浅灰色塑钢主体
            metal: '#353638',     // 不锈钢卡环
            terminal: '#8590d8'   // 逻辑端子颜色
        };

        // 2. 初始化视觉
        this.initVisuals();

        // 3. 动态添加端口坐标 (基于 this.w/h 的绝对坐标)
        // 我们需要根据方向来“旋转”端口的逻辑位置
        this._setupPorts();
    }

    initVisuals() {
        // 创建视觉组，中心点设为组件几何中心
        this.viewGroup = new Konva.Group({
            x: this.w / 2,
            y: this.h / 2,
            scaleX: this.scale,
            scaleY: this.scale
        });

        // 根据方向设置视觉旋转
        const rotMap = { 'up': 0, 'right': 90, 'down': 180, 'left': -90 };
        this.viewGroup.rotation(rotMap[this.direction] || 0);

        this.group.add(this.viewGroup);

        // 绘制中心块
        const centerBlock = new Konva.Rect({
            x: -20, y: -20,
            width: 40, height: 40,
            fill: this.colors.body,
            stroke: '#999',
            strokeWidth: 1,
            cornerRadius: 5
        });

        this.viewGroup.add(centerBlock);

        // 绘制三个方向的物理外观 (不含逻辑端口)
        this._drawPortVisual(0, -20, 0);   // 上 (u)
        this._drawPortVisual(-20, 0, -90); // 左 (l)
        this._drawPortVisual(20, 0, 90);   // 右 (r)
    }

    /** 绘制快插接口的物理外观 */
    _drawPortVisual(x, y, rotation) {
        const pG = new Konva.Group({ x, y, rotation });

        const pipe = new Konva.Rect({
            x: -15, y: -20,
            width: 30, height: 20,
            fill: this.colors.body,
            stroke: '#999', strokeWidth: 0.5
        });

        const metalRing = new Konva.Rect({
            x: -17, y: -24,
            width: 34, height: 6,
            fill: this.colors.metal,
            cornerRadius: 1
        });

        pG.add(pipe, metalRing);
        this.viewGroup.add(pG);
    }

    /** 根据旋转方向计算并添加逻辑端口 */
    _setupPorts() {
        const cx = this.w / 2;
        const cy = this.h / 2;
        const offset = 45 * this.scale; // 端口距离中心的距离

        // 定义原始(up方向)的相对偏移
        const rawOffsets = {
            'u': { dx: 0, dy: -offset },
            'l': { dx: -offset, dy: 0 },
            'r': { dx: offset, dy: 0 }
        };

        // 获取旋转弧度
        const rotMap = { 'up': 0, 'right': 90, 'down': 180, 'left': -90 };
        const rad = (rotMap[this.direction] || 0) * Math.PI / 180;

        // 对每个原始偏移进行旋转变换，计算最终在 group 坐标系下的位置
        ['u', 'l', 'r'].forEach(label => {
            const pos = rawOffsets[label];
            // 旋转矩阵计算
            const rx = pos.dx * Math.cos(rad) - pos.dy * Math.sin(rad);
            const ry = pos.dx * Math.sin(rad) + pos.dy * Math.cos(rad);

            // 使用 BaseComponent 的 addPort
            this.addPort(cx + rx, cy + ry, label, 'pipe');
        });
    }

    // 三通属于无源被动组件，不需要 update 或 _startLoop
    update() {
        // 如果以后要增加压力动画（比如管路变红），可在此实现
    }

    // --- 配置面板 ---
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { 
                label: '安装方向', 
                key: 'direction', 
                type: 'select',
                options: [
                    { label: '开口朝上', value: 'up' },
                    { label: '开口朝下', value: 'down' },
                    { label: '开口朝左', value: 'left' },
                    { label: '开口朝右', value: 'right' }
                ]
            }
        ];
    }

    onConfigUpdate(newConfig) {
        let needRebuild = false;
        if (newConfig.id) this.id = newConfig.id;
        
        if (newConfig.direction && newConfig.direction !== this.direction) {
            this.direction = newConfig.direction;
            needRebuild = true;
        }

        if (needRebuild) {
            // 重新设置端口和视觉
            this.viewGroup.destroy();
            this.ports.forEach(p => {
                if(p.node) p.node.destroy(); // 销毁旧端子
            });
            this.ports = []; 
            this.initVisuals();
            this._setupPorts();
        }
    }
}