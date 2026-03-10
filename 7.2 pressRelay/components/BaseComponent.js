export class BaseComponent {
    constructor(config, sys) {
        if (!sys) console.error(`组件 ${config.id} 缺少 sys 引用!`);
        this.sys = sys;
        this.config = config;
        this.id = config.id;

        this.group = new Konva.Group({
            x: config.x,
            y: config.y,
            rotation: config.rotation || 0, // 支持初始旋转
            draggable: true,
            id: config.id
        });
        this.ports = [];

        // 使用箭头函数确保 inside 调用时 this 指向正确
        this.group.on('dragmove', () => {
            // 无需判断，直接请求系统刷新所有连线
            this.sys.redrawAll();
        });
        // --- 新增：双击事件监听 ---
        this.group.on('dblclick', (e) => {
            // 阻止事件冒泡，防止触发舞台的双击逻辑
            e.cancelBubble = true;
            this.showConfigDialog();
        });

        // --- 新增：右键菜单监听 ---
        this.group.on('contextmenu', (e) => {
            // 阻止浏览器默认右键菜单
            e.evt.preventDefault();
            e.cancelBubble = true;
            this.showContextMenu(e.evt);
        });

    }

    // 新：支持 polarity 参数（电气端口 'p' 为红色），pipe 端口由三矩形组成，接口支持连线
    addPort(x, y, id, type = 'wire', polarity = null) {
        // 生成组件内唯一端口 id（保留原短 id 作为传参，但向系统传送合成 id 可选）
        const composedId = `${this.id}_${type}_${id}`;

        if (type === 'pipe') {
            // 管路端口由：引压管(tube)、密封箍(seal)、接口(iface) 三部分矩形组成
            const fillColor = (polarity === 'in') ? '#ff0000' : '#1395eb';
            const pg = new Konva.Group({ x, y, name: composedId });

            const tube = new Konva.Rect({ x: -10, y: -6, width: 20, height: 12, fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 1 });
            const seal = new Konva.Rect({ x: -8, y: -10, width: 16, height: 20, fill: '#7f8c8d', cornerRadius: 3 });
            const iface = new Konva.Rect({ x: -8, y: -8, width: 16, height: 16, fill: fillColor, stroke: '#2c3e50', strokeWidth: 1 });

            pg.add(tube, seal, iface);

            // 鼠标反馈（放大）
            pg.on('mouseenter', () => { pg.scale({ x: 1.06, y: 1.06 }); this.sys.stage.container().style.cursor = 'pointer'; this.sys.layer.draw(); });
            pg.on('mouseleave', () => { pg.scale({ x: 1, y: 1 }); this.sys.stage.container().style.cursor = 'default'; this.sys.layer.draw(); });

            // 仅接口部分响应连线点击，便于用户精确点击
            iface.on('mousedown', (e) => { e.cancelBubble = true; this.sys.handlePortClick(this, composedId, 'pipe'); });

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


    /**
     * 弹出对话框设置设备参数
     * 子类可以通过重写 getConfigFields() 来定义自己特有的参数界面
     */
    showConfigDialog() {
        // 1. 定义需要修改的字段，默认包含 id 和 基础备注
        // 子类如 Resistor 可以重写此方法返回 [{label: '阻值(Ω)', key: 'value', type: 'number'}]
        const fields = this.getConfigFields();

        // 2. 创建一个简易的 HTML 遮罩对话框
        const modal = document.createElement('div');
        modal.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 9999; font-family: sans-serif;
        `;

        const content = document.createElement('div');
        content.style = `
            background: white; padding: 20px; border-radius: 8px; 
            width: 300px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        `;
        content.innerHTML = `<h3 style="margin-top:0">配置设备: ${this.id}</h3>`;

        // 3. 动态生成输入框
        const inputs = {};
        fields.forEach(f => {
            const row = document.createElement('div');
            row.style = 'margin-bottom: 15px;';

            // 获取当前配置中的值
            const val = this.config[f.key] !== undefined ? this.config[f.key] : '';

            let inputHtml = '';

            // --- 新增：判断是否为 select 类型 ---
            if (f.type === 'select') {
                const optionsHtml = f.options.map(opt => {
                    // 如果当前值等于 option 的 value，标记为 selected
                    const isSelected = val == opt.value ? 'selected' : '';
                    return `<option value="${opt.value}" ${isSelected}>${opt.label}</option>`;
                }).join('');

                inputHtml = `
            <select id="diag_${f.key}" 
                    style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px; background:white;">
                ${optionsHtml}
            </select>
        `;
            } else {
                // 原有的 input 处理逻辑
                inputHtml = `
            <input type="${f.type || 'text'}" id="diag_${f.key}" 
                   value="${val}" 
                   style="width:100%; box-sizing:border-box; padding:8px; border:1px solid #ccc; border-radius:4px;">
        `;
            }

            row.innerHTML = `
        <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${f.label}</label>
        ${inputHtml}
    `;

            content.appendChild(row);
            inputs[f.key] = f;
        });

        // 4. 按钮区域
        const btnRow = document.createElement('div');
        btnRow.style = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = '取消';
        cancelBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #eee; border-radius: 4px;';

        const saveBtn = document.createElement('button');
        saveBtn.innerText = '保存';
        saveBtn.style = 'padding: 8px 15px; cursor: pointer; border: none; background: #1395eb; color: white; border-radius: 4px;';

        cancelBtn.onclick = () => this.sys.container.removeChild(modal);

        saveBtn.onclick = () => {
            const newConfig = { ...this.config };
            fields.forEach(f => {
                const el = document.getElementById(`diag_${f.key}`);
                let val = el.value;
                if (f.type === 'number') val = parseFloat(val);
                newConfig[f.key] = val;
            });
            // 更新本对象配置
            // this.config = newConfig; 手动在下面进行更新。
            // 调用更新回调（子类实现具体的重绘逻辑）
            this.onConfigUpdate(newConfig);
            this.sys.container.removeChild(modal);
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        content.appendChild(btnRow);
        modal.appendChild(content);
        this.sys.container.appendChild(modal);
    }

    /**
         * 子类重写：返回需要配置的字段列表
         */
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' }
        ];
    }

    /**
     * 子类重写：当配置保存后触发，用于刷新显示（如色环电阻重新算颜色）
     */
    onConfigUpdate(newConfig) {
        console.log('配置已更新:', newConfig);
        this.id = newConfig.id;
    }

    /**
     * 显示右键菜单
     */
    showContextMenu(evt) {
        // 移除已存在的菜单
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;
    `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => {
                onClick();
                menu.remove();
            };
            return item;
        };

        // 旋转功能
        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));

        // 示例：可以添加删除功能
        menu.appendChild(createItem('删除设备', () => {
            if (confirm('确定删除该设备及连线吗？')) {
                this.sys.removeComponent(this.id);
            }
        }));

        this.sys.container.appendChild(menu);

        // 点击其他地方关闭菜单
        const closeMenu = () => {
            menu.remove();
            window.removeEventListener('click', closeMenu);
        };
        window.addEventListener('click', closeMenu);
    }

    /**
     * 旋转组件
     * @param {number} deltaDeg 旋转增量角度
     */
    rotate(deltaDeg) {
        const currentRot = this.group.rotation();
        this.group.rotation(currentRot + deltaDeg);

        // 更新配置中的旋转角度（持久化需要）
        this.config.rotation = this.group.rotation();

        // 关键：旋转后所有连接到此组件的导线位置都会失效，必须重绘
        this.sys.redrawAll();
    }
}