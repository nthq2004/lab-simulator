import { BaseComponent } from './BaseComponent.js';

export class Diode extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'diode';
        this.vForward = config.vForward || 0.68; // 导通压降 (硅管通常为0.7V)
        this.rOn = 0.5;  // 导通后的动态电阻
        this.rOff = 1e8; // 截止时的极高电阻
        
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // p 为正极 (Anode)，n 为负极 (Cathode)
        this.addPort(-40, 0, 'l', 'wire', 'p'); 
        this.addPort(40, 0, 'r', 'wire', 'n');
    }

    initVisuals() {
        const stroke = '#000000';
        // 绘制引线
        this.group.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        this.group.add(new Konva.Line({ points: [15, 0, 40, 0], stroke, strokeWidth: 2 }));

        // 绘制二极管三角形符号 (正极指向负极)
        const triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        // 绘制负极竖线 (挡板)
        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: stroke,
            strokeWidth: 3
        });

        this.group.add(triangle, bar);
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' }
        ];
    }
}