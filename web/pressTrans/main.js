import { SimulationEngine } from './simulation.js';




// (id, state) =>，箭头函数，是仿真对象的onAction函数，带两个参数，实际是调用网络的发送函数，在WebSocket上面发送格式化数据，DO收到的是JSON数据。JSON字符串包括6个参数，type(教师指令、还是学生指令)、操纵模式、设备ID、动作、发送者、接受者。。。。。。。。。。。。。。。。。。。。。
//全局engine对象.onAction(id,state)方法
const engine = new SimulationEngine('container', (id, state) => {
});



// 监听窗口大小变化，调整舞台尺寸
window.addEventListener('resize', () => {
    //如果窗口高度小于500，隐藏最上面的信息栏，增加仿真区域高度
    // const infoBar = document.getElementById('info-bar');
    // const statusBar = document.getElementById('status-bar');
    // if (window.innerHeight < 500) {
    //     infoBar.style.display = 'none';
    //     statusBar.style.display = 'none';
    // } else {
    //     infoBar.style.display = 'flex';
    //     statusBar.style.display = 'flex';
    // }
    engine.resize();
});

// 绑定工具栏按钮到 engine 方法
window.addEventListener('DOMContentLoaded', () => {
    const map = {
        btnUndo: () => { engine.undo() },
        btnRedo: () => { engine.redo() },
        btnSet: () => {engine.openSettingsModal()},
        btnAutoWire: () => { engine.autoWire() },
        btnStep5: () => { engine.stepFive() },
        btnReset: () => { location.reload() },
    };
    Object.entries(map).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    });
});

//可设置2个故障。
const faultBtn = document.getElementById('faultBtn');
const faultModal = document.getElementById('faultModal');
const applyBtn = document.getElementById('applyBtn');
const cancelBtn = document.getElementById('cancelBtn');
const faultForm = document.getElementById('faultForm');

/**
 * 核心：检测 sys 中各组件的物理状态，同步到 UI 勾选框
 */
function syncUIWithSystem() {
    // const pTr = engine.devices['pTr'];
    // const dcP = engine.devices['dcP'];
    // const pGa = sys.comps['valve'];

    const candidates = [];
    const tryPush = (id) => { const term = engine.stage.findOne('#' + id); if (term) candidates.push(term); };
    tryPush('pTr_pipe_i');
    tryPush('pGa_pipe_i');
    const hasLeaking = candidates.some(term => term.getAttr('isLeaking') === true);

    const checkboxes = faultForm.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(cb => {
        const code = parseInt(cb.value);
        let isActivated = false;

        // 根据 engine 内部组件的实际变量值判断故障是否存在
        switch (code) {
            case 1: isActivated = (engine._break !== null); break; // 回路开路
            case 2: isActivated = (hasLeaking === true); break; // 回路漏气        
        }
        cb.checked = isActivated;
    });
}

/**
 * 修复特定故障，恢复 sys 组件的默认参数
 */
function repairFault(code) {

    switch (code) {
        case 1:
            engine._break = null;
            engine.devices['pTr'].isBroken = false;
            const term = engine.stage.findOne('#dcP_wire_p');
                    term.setAttr('isBroken', false);
            break;
        case 2:
            Object.values(engine.devices).forEach(dev => {
                if (dev.terminals && Array.isArray(dev.terminals)) dev.terminals.forEach(t => t.setAttr('isLeaking', false));
            });
            break;
    };
    engine.updateAllDevices();
}

// 绑定打开按钮
faultBtn.onclick = () => {
    syncUIWithSystem();
    faultModal.style.display = 'flex';
};

// 绑定取消按钮
cancelBtn.onclick = () => {
    faultModal.style.display = 'none';
};

// 绑定应用按钮
applyBtn.onclick = () => {
    const checkboxes = faultForm.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(cb => {
        const code = parseInt(cb.value);
        if (cb.checked) {
            // 勾选：调用 sys 注入故障
            engine.setFault(code);
        } else {
            // 未勾选：调用修复逻辑（见下方定义）
            repairFault(code);
        }
    });

    faultModal.style.display = 'none';

    engine.updateAllDevices(); // 
};


window.addEventListener('DOMContentLoaded', (event) => {
    // 调用你的初始化逻辑
    initControlLogic();
});
//选择框，不管是自动演示、单步演示、演练、评估，先在这里选择项目
function initControlLogic() {
    const taskSelect = document.getElementById('taskSelect');
    const buttons = [
        document.getElementById('btnShow'),
        document.getElementById('btnStep'),
        document.getElementById('btnTrain'),
        document.getElementById('btnEval')
    ];

    // 定义一个内部函数，用于根据下拉框的值刷新按钮状态
    const refreshUI = () => {
        const isSelected = taskSelect.value !== "";

        buttons.forEach(btn => {
            if (btn) {
                btn.disabled = !isSelected;
                // 视觉反馈
                btn.style.cursor = isSelected ? 'pointer' : 'not-allowed';
                btn.style.opacity = isSelected ? '1' : '0.5';
            }
        });
    };

    // 1. 文档加载/初始化时立即执行一次逻辑
    // 如果是封装在类中，这里直接执行一次即可
    refreshUI();

    // 2. 监听后续的手动变化
    taskSelect.addEventListener('change', () => {
        refreshUI();
        engine.switchWorkflow(taskSelect.value);
    });
}

// 全自动演示，先选择要演示的项目
const btnShow = document.getElementById('btnShow');
if (btnShow) {
    btnShow.onclick = () => {
        engine.openWorkflowPanel('show');
    };
}
// 单步演示，先选择要演示的项目
const btnStep = document.getElementById('btnStep');
if (btnStep) {
    btnStep.onclick = () => {
        engine.stepByStep();
    };
}
// 练习，先选择要练习的项目
const btnTrain = document.getElementById('btnTrain');
if (btnTrain) {
    btnTrain.onclick = () => {
        engine.openWorkflowPanel('train');
    };
}
// 评估，先选择要评估的项目
const btnEval = document.getElementById('btnEval')
if (btnEval) {
    btnEval.onclick = () => {
        engine.openWorkflowPanel('eval');
    };
}