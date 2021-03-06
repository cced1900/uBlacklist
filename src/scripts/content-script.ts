// #if CHROMIUM
/*
// #else
import dialogPolyfill from 'dialog-polyfill';
// #endif
// #if CHROMIUM
*/
// #endif
import mobile from 'is-mobile';
import { apis } from './apis';
import { Blacklist } from './blacklist';
import { BlockForm } from './block-form';
import * as LocalStorage from './local-storage';
import { sendMessage } from './messages';
import { supportedSearchEngines } from './supported-search-engines';
import { AltURL, MatchPattern } from './utilities';
import { SearchEngineHandlers } from './types';
import contentScriptStyle from '!!raw-loader!extract-loader!css-loader!sass-loader!../styles/content-script.scss';

let blacklist: Blacklist | null = null;
let blockForm: BlockForm | null = null;
let blockedEntryCount = 0;
const queuedEntries: HTMLElement[] = [];
let shouldEnablePathDepth = false;
let skipBlockDialog = false;

function $(id: 'ub-control'): HTMLElement | null;
function $(id: 'ub-block-dialog'): HTMLDialogElement | null;
function $(id: 'ub-block-form'): HTMLDivElement | null;
function $(id: string): Element | null {
  return document.getElementById(id);
}

function judgeEntry(entry: HTMLElement): void {
  if (blacklist!.test(new AltURL(entry.dataset.ubUrl!))) {
    ++blockedEntryCount;
    entry.classList.add('ub-is-blocked');
  }
}

function onBlacklistUpdated(): void {
  sendMessage('set-blacklist', blacklist!.toString(), 'content-script');
  blockedEntryCount = 0;
  for (const entry of document.querySelectorAll<HTMLElement>('[data-ub-url]')) {
    entry.classList.remove('ub-is-blocked');
    judgeEntry(entry);
  }
  if (!blockedEntryCount) {
    document.documentElement.classList.add('ub-hide');
  }
  updateControl();
}

function onDOMContentLoaded(handlers: SearchEngineHandlers): void {
  for (const controlHandler of handlers.controlHandlers) {
    const control = controlHandler.createControl();
    if (!control) {
      continue;
    }
    control.id = 'ub-control';
    control.classList.add('ub-control');
    control.innerHTML = `
<span class="ub-stats"></span>
<span class="ub-show-button">
  ${apis.i18n.getMessage('content_showBlockedSitesLink')}
</span>
<span class="ub-hide-button">
  ${apis.i18n.getMessage('content_hideBlockedSitesLink')}
</span>`;
    const showButton = control.querySelector<HTMLElement>('.ub-show-button')!;
    const hideButton = control.querySelector<HTMLElement>('.ub-hide-button')!;
    for (const button of [showButton, hideButton]) {
      registerButton(button);
    }
    showButton.addEventListener('click', () => {
      document.documentElement.classList.remove('ub-hide');
    });
    hideButton.addEventListener('click', () => {
      document.documentElement.classList.add('ub-hide');
    });
    if (controlHandler.adjustControl) {
      controlHandler.adjustControl(control);
    }
    updateControl();
    break;
  }
  document.body.insertAdjacentHTML(
    'beforeend',
    `
<dialog id="ub-block-dialog" class="ub-block-dialog" tabindex="-1">
  <div id="ub-block-form"></div>
</dialog>`,
  );
  const blockDialog = $('ub-block-dialog')!;
  // #if CHROMIUM
  /*
  // #else
  dialogPolyfill.registerDialog(blockDialog);
  // #endif
  // #if CHROMIUM
  */
  // #endif
  blockDialog.addEventListener('click', e => {
    if (e.target === blockDialog) {
      blockDialog.close();
    }
  });
  blockForm = new BlockForm($('ub-block-form')!, () => {
    blockDialog.close();
  });
  if (shouldEnablePathDepth) {
    blockForm.enablePathDepth();
    shouldEnablePathDepth = false;
  }
}

function onElementAdded(addedElement: HTMLElement, handlers: SearchEngineHandlers): void {
  for (const entryHandler of handlers.entryHandlers) {
    const entry = entryHandler.getEntry(addedElement);
    if (!entry || entry.hasAttribute('data-ub-url')) {
      continue;
    }
    const url = entryHandler.getURL(entry);
    if (url == null) {
      continue;
    }
    const action = entryHandler.createAction(entry);
    if (!action) {
      continue;
    }
    entry.setAttribute('data-ub-url', url);
    action.classList.add('ub-action');
    action.innerHTML = `
<span class="ub-block-button">
  ${apis.i18n.getMessage('content_blockSiteLink')}
</span>
<span class="ub-unblock-button">
  ${apis.i18n.getMessage('content_unblockSiteLink')}
</span>`;
    const blockButton = action.querySelector<HTMLElement>('.ub-block-button')!;
    const unblockButton = action.querySelector<HTMLElement>('.ub-unblock-button')!;
    for (const button of [blockButton, unblockButton]) {
      registerButton(button);
      button.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!blacklist) {
          return;
        }
        if (skipBlockDialog) {
          blacklist.createPatch(new AltURL(url));
          blacklist.applyPatch();
          onBlacklistUpdated();
        } else {
          blockForm!.initialize(blacklist, new AltURL(url), onBlacklistUpdated);
          const blockDialog = $('ub-block-dialog')!;
          blockDialog.showModal();
          blockDialog.focus();
        }
      });
    }
    if (entryHandler.adjustEntry) {
      entryHandler.adjustEntry(entry);
    }
    if (blacklist) {
      judgeEntry(entry);
      updateControl();
    } else {
      queuedEntries.push(entry);
    }
    return;
  }
}

function onOptionsLoaded(
  options: LocalStorage.ItemsFor<
    [
      'blacklist',
      'subscriptions',
      'hideControl',
      'hideBlockLinks',
      'skipBlockDialog',
      'enablePathDepth',
    ]
  >,
): void {
  blacklist = new Blacklist(
    options.blacklist,
    Object.values(options.subscriptions).map(subscription => subscription.blacklist),
  );
  for (const entry of queuedEntries) {
    judgeEntry(entry);
  }
  queuedEntries.length = 0;
  updateControl();
  if (options.hideControl) {
    document.documentElement.classList.add('ub-hide-control');
  }
  if (options.hideBlockLinks) {
    document.documentElement.classList.add('ub-hide-actions');
  }
  skipBlockDialog = options.skipBlockDialog;
  if (options.enablePathDepth) {
    if (blockForm) {
      blockForm.enablePathDepth();
    } else {
      shouldEnablePathDepth = true;
    }
  }
}

function registerButton(button: HTMLElement): void {
  button.classList.add('ub-button');
  button.tabIndex = 0;
  button.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      button.click();
    }
  });
}

function updateControl(): void {
  const control = $('ub-control');
  if (!control) {
    return;
  }
  if (blockedEntryCount) {
    control.classList.remove('ub-is-hidden');
    control.querySelector('.ub-stats')!.textContent =
      blockedEntryCount === 1
        ? apis.i18n.getMessage('content_singleSiteBlocked')
        : apis.i18n.getMessage('content_multipleSitesBlocked', String(blockedEntryCount));
  } else {
    control.classList.add('ub-is-hidden');
  }
}

function main(): void {
  (async () => {
    const options = await LocalStorage.load([
      'blacklist',
      'subscriptions',
      'hideControl',
      'hideBlockLinks',
      'skipBlockDialog',
      'enablePathDepth',
    ]);
    onOptionsLoaded(options);
  })();

  const url = new AltURL(window.location.href);
  const searchEngine = Object.values(supportedSearchEngines).find(searchEngine =>
    searchEngine.matches.some(match => new MatchPattern(match).test(url)),
  );
  if (!searchEngine) {
    return;
  }
  const handlers = searchEngine.getHandlers(
    window.location.href,
    mobile({ ua: window.navigator.userAgent, tablet: true }),
  );
  if (!handlers) {
    return;
  }

  document.documentElement.classList.add('ub-hide');

  let stylesInserted = false;
  const insertStyles = () => {
    if (!stylesInserted && document.head) {
      document.head.insertAdjacentHTML(
        'beforeend',
        `<style>${contentScriptStyle}</style><style>${searchEngine!.style}</style>`,
      );
      stylesInserted = true;
    }
  };
  insertStyles();

  if (handlers.getAddedElements) {
    for (const addedElement of handlers.getAddedElements()) {
      onElementAdded(addedElement, handlers);
    }
  }
  new MutationObserver(records => {
    insertStyles();

    for (const record of records) {
      for (const addedNode of record.addedNodes) {
        if (addedNode instanceof HTMLElement) {
          // #if DEBUG
          console.debug(addedNode.cloneNode(true));
          // #endif
          onElementAdded(addedNode, handlers);
          if (handlers.getSilentlyAddedElements) {
            for (const silentlyAddedElement of handlers.getSilentlyAddedElements(addedNode)) {
              onElementAdded(silentlyAddedElement, handlers);
            }
          }
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      onDOMContentLoaded(handlers);
    });
  } else {
    onDOMContentLoaded(handlers);
  }
}

main();
