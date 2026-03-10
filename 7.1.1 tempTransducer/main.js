import { ControlSystem } from './consys.js';

window.sys = new ControlSystem();

// 1. 定义按钮 ID 与对应操作的映射表
const actionMap = {
    'btnUndo': () => sys.history.undo(),
    'btnRedo': () => sys.history.redo(),
    'btnAutoWire': () => sys.applyAllPresets(),
    'btnStartSys': () => sys.applyStartSystem(),
    'btnReset': () => location.reload()
};
// 2. 统一遍历并绑定事件
Object.entries(actionMap).forEach(([id, action]) => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = action;
});


// 1. 配置化故障定义：code -> { 检测逻辑, 修复逻辑 }
const FAULT_CONFIG = {
    1: {
        check: (sys) => sys.comps['pt']?.isOpen === true,
        repair: (sys) => { if (sys.comps['pt']) sys.comps['pt'].isOpen = false; }
    },
    2: {
        check: (sys) => sys.comps['pt']?.isShort === true,
        repair: (sys) => { if (sys.comps['pt']) sys.comps['pt'].isShort = false; }
    }
};

// 2. 统一 UI 交互逻辑
const faultUI = {
    modal: document.getElementById('faultModal'),
    form:  document.getElementById('faultForm'),
    
    // 打开/关闭 弹窗
    toggle: (visible) => {
        if (visible) faultUI.sync();
        faultUI.modal.style.display = visible ? 'flex' : 'none';
    },

    // 同步系统状态到 UI
    sync: () => {
        faultUI.form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const cfg = FAULT_CONFIG[cb.value];
            if (cfg) cb.checked = cfg.check(sys);
        });
    },

    // 应用 UI 勾选到系统
    apply: () => {
        faultUI.form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const code = cb.value;
            const cfg = FAULT_CONFIG[code];
            if (!cfg) return;

            cb.checked ? sys.setFault(parseInt(code)) : cfg.repair(sys);
        });
        faultUI.toggle(false);
        sys.layer.batchDraw();
    }
};

// 3. 简洁的事件绑定
document.getElementById('faultBtn').onclick  = () => faultUI.toggle(true);
document.getElementById('cancelBtn').onclick = () => faultUI.toggle(false);
document.getElementById('applyBtn').onclick  = () => faultUI.apply();


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
        sys.switchWorkflow(taskSelect.value);
    });
}

// 1. 定义映射配置：ID -> 模式
const workflowMap = {
    'btnShow': 'show',
    'btnStep': 'step',
    'btnTrain': 'train',
    'btnEval': 'eval'
};
// 2. 统一遍历绑定
Object.entries(workflowMap).forEach(([id, mode]) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.onclick = () => sys.openWorkflowPanel(mode);
    }
});

// 监听窗口大小变化，调整舞台尺寸
window.addEventListener('resize', () => {
    sys.stage.width(sys.container.offsetWidth);
    sys.stage.height(sys.container.offsetHeight);
    sys.redrawAll();
});