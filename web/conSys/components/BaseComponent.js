export class BaseComponent {
    constructor(config, sys) {
        if (!sys) console.error(`组件 ${config.id} 缺少 sys 引用!`);
        this.sys = sys;
        this.id = config.id;

        this.group = new Konva.Group({
            x: config.x,
            y: config.y,
            draggable: true,
            id: config.id
        });
        this.ports = [];

        // 使用箭头函数确保 inside 调用时 this 指向正确
        this.group.on('dragmove', () => {
            // 无需判断，直接请求系统刷新所有连线
            this.sys.redrawAll();
        });
    }

    // 新：支持 polarity 参数（电气端口 'p' 为红色），pipe 端口由三矩形组成，接口支持连线
    addPort(x, y, id, type = 'wire', polarity = null) {
        // 生成组件内唯一端口 id（保留原短 id 作为传参，但向系统传送合成 id 可选）
        const composedId = `${this.id}_${type}_${id}`;

        if (type === 'pipe') {
            // 管路端口由：引压管(tube)、密封箍(seal)、接口(iface) 三部分矩形组成
            const pg = new Konva.Group({ x, y, name: composedId });

            const tube = new Konva.Rect({ x: -10, y: -6, width: 20, height: 12, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
            const seal = new Konva.Rect({ x: -8, y: -10, width: 16, height: 20, fill: '#7f8c8d', cornerRadius: 3 });
            const iface = new Konva.Rect({ x: -8, y: -8, width: 16, height: 16, fill: '#1395eb', stroke: '#2c3e50', strokeWidth: 1 });

            pg.add(tube, seal, iface);

            // 鼠标反馈（放大）
            pg.on('mouseenter', () => { pg.scale({ x: 1.06, y: 1.06 }); this.sys.stage.container().style.cursor = 'pointer'; this.sys.layer.draw(); });
            pg.on('mouseleave', () => { pg.scale({ x: 1, y: 1 }); this.sys.stage.container().style.cursor = 'default'; this.sys.layer.draw(); });

            // 仅接口部分响应连线点击，便于用户精确点击
            iface.on('mousedown', (e) => { e.cancelBubble = true; this.sys.handlePortClick( this,composedId, 'pipe'); });

            this.group.add(pg);
            this.ports.push({ id: composedId, origId: id, x, y, type: 'pipe', node: pg, parts: { tube, seal, iface } });
            return;
        }

        // 电气端口
        const fillColor = (polarity === 'p') ? '#ff0000' : '#130901';
        const port = new Konva.Circle({ x, y, radius: 6, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1, name: composedId, hitStrokeWidth: 10 });

        port.on('mouseenter', () => { port.radius(8); this.sys.stage.container().style.cursor = 'pointer'; this.sys.layer.draw(); });
        port.on('mouseleave', () => { port.radius(6); this.sys.stage.container().style.cursor = 'default'; this.sys.layer.draw(); });

        port.on('mousedown', (e) => { e.cancelBubble = true; this.sys.handlePortClick(this, composedId, 'wire'); });

        this.group.add(port);
        this.ports.push({ id: composedId, origId: id, x, y, type: 'wire', polarity, node: port });
    }

    getAbsPortPos(portId) {
        const port = this.ports.find(p => p.id === portId);
        if (!port) return { x: 0, y: 0 };

        // 优先使用节点的绝对位置（考虑了 group 的平移/旋转/缩放）
        if (port.node && typeof port.node.getAbsolutePosition === 'function') {
            const pos = port.node.getAbsolutePosition();
            return { x: pos.x, y: pos.y };
        }

        // 回退：使用 group 的绝对变换将本地点转换为舞台坐标（支持旋转/缩放）
        try {
            const p = this.group.getAbsoluteTransform().point({ x: port.x || 0, y: port.y || 0 });
            return { x: p.x, y: p.y };
        } catch (e) {
            return { x: this.group.x() + (port.x || 0), y: this.group.y() + (port.y || 0) };
        }
    }
}