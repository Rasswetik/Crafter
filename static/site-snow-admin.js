/* Admin panel: global snowfall switch with visual preview. */
let crafterSnowOriginal=null;
async function renderAdminSnow(content=document.querySelector('#admin-content')){
    const config=await api('site/snow');
    if(!content?.isConnected)return;
    crafterSnowOriginal={...config};
    const selectOptions=(name,options)=>options.map(([value,label])=>
        '<option value="'+value+'" '+(config[name]===value?'selected':'')+'>'+label+'</option>').join('');
    content.innerHTML='<section class="panel crafter-snow-admin">'+
        '<h3>Снег на всём сайте</h3>'+
        '<p class="sub">Настраиваемый снег в маркете, профиле, Arena, на страницах подарков и в админке. Эффект не перехватывает нажатия и автоматически приостанавливается, когда вкладка скрыта.</p>'+
        '<div class="crafter-snow-controls">'+
            '<label class="crafter-snow-switch"><input type="checkbox" name="enabled" '+
            (config.enabled?'checked':'')+'><span><strong>Включить снег</strong><small>Глобально для всех пользователей</small></span></label>'+
            '<label>Количество снежинок<select class="field" name="density">'+
                selectOptions('density',[['light','Немного'],['normal','Средне'],['heavy','Много']])+'</select></label>'+
            '<label>Скорость падения<select class="field" name="speed">'+
                selectOptions('speed',[['slow','Медленно'],['normal','Обычно'],['fast','Быстро']])+'</select></label>'+
            '<label>Размер снежинок<select class="field" name="size">'+
                selectOptions('size',[['small','Маленькие'],['normal','Обычные'],['large','Крупные']])+'</select></label>'+
        '</div><div class="crafter-snow-admin-buttons">'+
            '<button type="button" class="secondary" data-snow-preview>Предпросмотр</button>'+
            '<button type="button" class="primary" data-snow-save>Сохранить для всех</button>'+
            '<button type="button" class="secondary" data-snow-reset>Вернуть настройки</button>'+
        '</div><p role="status" class="sub" data-snow-status>Настройки доступны только администраторам.</p></section>';
    const root=content.querySelector('.crafter-snow-admin');
    function read(){
        return {
            enabled:root.querySelector('[name=enabled]').checked,
            density:root.querySelector('[name=density]').value,
            speed:root.querySelector('[name=speed]').value,
            size:root.querySelector('[name=size]').value
        };
    }
    function fill(settings){
        root.querySelector('[name=enabled]').checked=settings.enabled;
        for(const key of ['density','speed','size'])
            root.querySelector('[name='+key+']').value=settings[key];
    }
    root.querySelector('[data-snow-preview]').onclick=()=>{
        window.crafterSnowApply?.(read());
        root.querySelector('[data-snow-status]').textContent=
            'Предпросмотр виден только здесь. Для всех пользователей нажмите «Сохранить для всех».';
    };
    root.querySelector('[data-snow-reset]').onclick=()=>{
        fill(crafterSnowOriginal);
        window.crafterSnowApply?.(crafterSnowOriginal);
        root.querySelector('[data-snow-status]').textContent='Предпросмотр сброшен.';
    };
    root.querySelector('[data-snow-save]').onclick=async()=>{
        const button=root.querySelector('[data-snow-save]');
        button.disabled=true;
        try{
            const result=await api('admin/site/snow',read());
            crafterSnowOriginal={...result.snow};
            window.crafterSnowApply?.(result.snow);
            root.querySelector('[data-snow-status]').textContent=
                result.snow.enabled?'Снег включён на всём сайте.':'Снег отключён на всём сайте.';
            toast('Настройки снега сохранены');
        }catch(error){
            root.querySelector('[data-snow-status]').textContent=error.message;
            toast(error.message);
        }finally{button.disabled=false;}
    };
}