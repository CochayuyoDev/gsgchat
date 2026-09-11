/**
 * Los cuadros de dialogo del sistema, propios y no del navegador.
 *
 * `prompt()` y `confirm()` funcionan, pero se ven como una alerta de virus de
 * 2003: sin estilo, sin explicar nada, con el nombre del sitio delante y sin
 * sitio para decir "ese numero no es valido". Ademas **congelan la pagina
 * entera** mientras estan abiertos, y estas pantallas se refrescan solas cada
 * pocos segundos.
 *
 * Esto los sustituye por un cuadro propio: se explica lo que se pide, se
 * valida antes de cerrar y el error sale dentro del mismo cuadro.
 *
 * Se comparte entre las cuatro pantallas metiendo `DIALOGO_CSS` en el <style>
 * y `DIALOGO_JS` en el <script>. No hay framework: son ~120 lineas de JS.
 */

export const DIALOGO_CSS = `
  .dlg-fondo {
    position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
    background: rgba(11, 20, 26, .55); backdrop-filter: blur(2px);
    padding: 20px; animation: dlg-aparece .12s ease-out;
  }
  @keyframes dlg-aparece { from { opacity: 0 } to { opacity: 1 } }
  @keyframes dlg-sube { from { transform: translateY(8px); opacity: .6 } to { transform: none; opacity: 1 } }
  .dlg {
    background: var(--panel, #fff); color: var(--text, #111b21);
    border-radius: 14px; width: min(430px, 100%); padding: 22px;
    box-shadow: 0 18px 50px rgba(0,0,0,.28); animation: dlg-sube .14s ease-out;
  }
  .dlg h3 { margin: 0 0 8px; font-size: 17px; }
  .dlg p { margin: 0 0 14px; font-size: 13.5px; color: var(--muted, #667781); line-height: 1.45; }
  .dlg label { display: block; font-size: 12.5px; color: var(--muted, #667781); margin-bottom: 5px; }
  .dlg .caja { display: flex; align-items: center; gap: 0; }
  /* El prefijo del pais va pegado al campo: se ve que forma parte del numero. */
  .dlg .prefijo {
    background: var(--chip, #f0f2f5); border: 1px solid var(--line, #e3e5e9); border-right: 0;
    border-radius: 9px 0 0 9px; padding: 11px 12px; font-size: 15px; color: var(--muted, #667781);
  }
  .dlg .caja input { border-radius: 0 9px 9px 0; }
  .dlg input {
    width: 100%; font: inherit; font-size: 15px; padding: 11px 12px;
    border: 1px solid var(--line, #e3e5e9); border-radius: 9px;
    background: var(--bg, #fff); color: var(--text, #111b21);
  }
  .dlg input:focus { outline: 2px solid var(--accent, #128c7e); outline-offset: -1px; border-color: transparent; }
  .dlg .ayuda { font-size: 12px; color: var(--muted, #667781); margin-top: 6px; }
  .dlg .mal { font-size: 13px; color: #dc2626; margin-top: 8px; min-height: 0; }
  .dlg .botones { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
  .dlg button {
    font: inherit; font-size: 14px; padding: 9px 16px; border-radius: 9px; cursor: pointer;
    border: 1px solid var(--line, #e3e5e9); background: var(--panel, #fff); color: var(--text, #111b21);
  }
  .dlg button.principal { background: var(--accent, #128c7e); border-color: var(--accent, #128c7e); color: #fff; }
  .dlg button.principal:hover { filter: brightness(1.08); }
  .dlg button.peligro { background: #dc2626; border-color: #dc2626; color: #fff; }
`;

export const DIALOGO_JS = String.raw`
/** El fallo de red o de servidor, dicho para quien no programa. */
function errorHttp(estado) {
  if (estado === 403) return 'No tienes permiso para hacer eso.';
  if (estado === 404) return 'Eso ya no existe: recarga la pagina.';
  if (estado === 409) return 'No se pudo hacer ahora mismo.';
  if (estado === 429) return 'Demasiadas peticiones seguidas: espera unos segundos.';
  if (estado >= 500) return 'El servidor tuvo un problema. Revisa la ventana donde arranco el sistema.';
  return 'No se pudo completar la operacion (codigo ' + estado + ').';
}

/**
 * Pide un dato en un cuadro propio. Devuelve el valor o null si se cancela.
 *
 * opciones: titulo, texto, etiqueta, valor, marcador, ayuda, prefijo, boton,
 * y validar(valor), que devuelve un mensaje de error o null si esta bien.
 */
function pedirDato(opciones) {
  opciones = opciones || {};
  return new Promise(function (resolver) {
    var fondo = document.createElement('div');
    fondo.className = 'dlg-fondo';
    fondo.innerHTML =
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<h3></h3>' +
        (opciones.texto ? '<p></p>' : '') +
        (opciones.etiqueta ? '<label for="dlg-campo"></label>' : '') +
        '<div class="caja">' +
          (opciones.prefijo ? '<span class="prefijo"></span>' : '') +
          '<input id="dlg-campo" autocomplete="off" spellcheck="false">' +
        '</div>' +
        (opciones.ayuda ? '<div class="ayuda"></div>' : '') +
        '<div class="mal" id="dlg-mal"></div>' +
        '<div class="botones">' +
          '<button type="button" id="dlg-no">Cancelar</button>' +
          '<button type="button" class="principal" id="dlg-si"></button>' +
        '</div>' +
      '</div>';

    /* Los textos se ponen con textContent y no en el HTML: asi un valor con
       comillas o con < no puede romper el cuadro ni inyectar nada. */
    fondo.querySelector('h3').textContent = opciones.titulo || 'Escribe un dato';
    if (opciones.texto) fondo.querySelector('p').textContent = opciones.texto;
    if (opciones.etiqueta) fondo.querySelector('label').textContent = opciones.etiqueta;
    if (opciones.prefijo) fondo.querySelector('.prefijo').textContent = opciones.prefijo;
    if (opciones.ayuda) fondo.querySelector('.ayuda').textContent = opciones.ayuda;
    fondo.querySelector('#dlg-si').textContent = opciones.boton || 'Guardar';

    var campo = fondo.querySelector('#dlg-campo');
    campo.value = opciones.valor || '';
    campo.placeholder = opciones.marcador || '';

    var mal = fondo.querySelector('#dlg-mal');

    function cerrar(valor) {
      document.removeEventListener('keydown', teclas);
      fondo.remove();
      resolver(valor);
    }
    function aceptar() {
      var valor = campo.value.trim();
      var error = opciones.validar ? opciones.validar(valor) : (valor ? null : 'Escribe algo, por favor.');
      if (error) {
        mal.textContent = error;
        campo.focus();
        campo.select();
        return;
      }
      cerrar(valor);
    }
    function teclas(evento) {
      if (evento.key === 'Escape') cerrar(null);
      if (evento.key === 'Enter' && document.querySelector('.dlg-fondo')) aceptar();
    }

    fondo.querySelector('#dlg-si').onclick = aceptar;
    fondo.querySelector('#dlg-no').onclick = function () { cerrar(null); };
    /* Pulsar fuera del cuadro cancela; dentro, no. */
    fondo.onclick = function (evento) { if (evento.target === fondo) cerrar(null); };
    campo.oninput = function () { mal.textContent = ''; };
    document.addEventListener('keydown', teclas);

    document.body.appendChild(fondo);
    campo.focus();
    campo.select();
  });
}

/** Pregunta si o no. Devuelve true o false, nunca congela la pagina. */
function confirmarDialogo(opciones) {
  opciones = opciones || {};
  return new Promise(function (resolver) {
    var fondo = document.createElement('div');
    fondo.className = 'dlg-fondo';
    fondo.innerHTML =
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<h3></h3><p></p>' +
        '<div class="botones">' +
          '<button type="button" id="dlg-no">Cancelar</button>' +
          '<button type="button" id="dlg-si"></button>' +
        '</div>' +
      '</div>';
    fondo.querySelector('h3').textContent = opciones.titulo || 'Confirmar';
    fondo.querySelector('p').textContent = opciones.texto || '';

    var si = fondo.querySelector('#dlg-si');
    si.textContent = opciones.boton || 'Continuar';
    si.className = opciones.peligro ? 'peligro' : 'principal';

    function cerrar(valor) {
      document.removeEventListener('keydown', teclas);
      fondo.remove();
      resolver(valor);
    }
    function teclas(evento) {
      if (evento.key === 'Escape') cerrar(false);
      if (evento.key === 'Enter') cerrar(true);
    }

    si.onclick = function () { cerrar(true); };
    fondo.querySelector('#dlg-no').onclick = function () { cerrar(false); };
    fondo.onclick = function (evento) { if (evento.target === fondo) cerrar(false); };
    document.addEventListener('keydown', teclas);

    document.body.appendChild(fondo);
    si.focus();
  });
}

/**
 * El token de administracion, pidiendolo con el cuadro propio.
 *
 * Es asincrono porque el cuadro no bloquea: quien llame tiene que esperarlo.
 */
async function pedirToken() {
  var guardado = sessionStorage.getItem('adminToken');
  if (guardado) return guardado;

  var valor = await pedirDato({
    titulo: 'Contraseña de administración',
    texto:
      'Es la clave que protege este panel. Aparece en la ventana donde arrancaste el ' +
      'sistema, y también está guardada en el archivo .secrets.json de la carpeta del proyecto.',
    etiqueta: 'Pega aquí la clave',
    marcador: 'pega aqui la clave (32 caracteres)',
    boton: 'Entrar',
    validar: function (v) {
      if (!v) return 'Pega la clave para continuar.';
      if (v.length < 16) return 'Esa clave es demasiado corta: cópiala entera.';
      return null;
    }
  });

  if (!valor) return '';
  sessionStorage.setItem('adminToken', valor);
  return valor;
}

/**
 * Un número de celular peruano, listo para WhatsApp.
 *
 * En Perú los celulares tienen 9 dígitos y empiezan por 9; el prefijo del
 * país (51) lo pone el sistema. Se acepta pegado como sea -con espacios,
 * guiones o con el +51 delante- y se limpia aquí.
 */
async function pedirCelular(opciones) {
  opciones = opciones || {};
  var valor = await pedirDato({
    titulo: opciones.titulo || 'Escribir a un número nuevo',
    texto: opciones.texto || 'Se abrirá una conversación con ese número, aunque nunca te haya escrito.',
    etiqueta: 'Celular',
    prefijo: '+51',
    marcador: '987 654 321',
    ayuda: 'Nueve dígitos, empezando por 9. Si el número es de otro país, escríbelo completo con su código.',
    boton: opciones.boton || 'Abrir conversación',
    validar: function (v) {
      var digitos = (v || '').replace(/\D+/g, '');
      if (!digitos) return 'Escribe el número de celular.';
      var nacional = digitos.indexOf('51') === 0 && digitos.length > 9 ? digitos.slice(2) : digitos;
      if (nacional.length < 9) return 'Faltan dígitos: un celular peruano tiene 9.';
      if (nacional.length === 9 && nacional[0] !== '9') return 'Los celulares en Perú empiezan por 9.';
      if (nacional.length > 15) return 'Ese número tiene demasiados dígitos.';
      return null;
    }
  });

  if (!valor) return null;
  var digitos = valor.replace(/\D+/g, '');
  if (digitos.length === 9) return '51' + digitos;
  return digitos;
}
`;
