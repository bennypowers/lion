// eslint-disable-next-line max-classes-per-file
import { html, css } from '@lion/core';
import { OverlayMixin, withDropdownConfig } from '@lion/overlays';
import { LionListbox } from '@lion/listbox';

// TODO: make ListboxOverlayMixin that is shared between SelectRich and Combobox
// TODO: extract option matching based on 'typed character cache' and share that logic
// on Listbox or ListNavigationWithActiveDescendantMixin

/**
 * @typedef {import('@lion/listbox').LionOption} LionOption
 * @typedef {import('@lion/listbox').LionOptions} LionOptions
 * @typedef {import('@lion/overlays/types/OverlayConfig').OverlayConfig} OverlayConfig
 * @typedef {import('@lion/core/types/SlotMixinTypes').SlotsMap} SlotsMap
 */

/**
 * LionCombobox: implements the wai-aria combobox design pattern and integrates it as a Lion
 * FormControl
 */

export class LionCombobox extends OverlayMixin(LionListbox) {
  static get properties() {
    return {
      autocomplete: String,
      matchMode: {
        type: String,
        attribute: 'match-mode',
      },
      __shouldAutocompleteNextUpdate: Boolean,
    };
  }

  static get styles() {
    // TODO: share input-group css?
    return [
      super.styles,
      css`
        :host [role='combobox'] ::slotted(input) {
          outline: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border: none;
          border-bottom: 1px solid;
        }

        :host ::slotted([role='listbox']) {
          max-height: 200px;
          display: block;
          overflow: auto;
        }
      `,
    ];
  }

  /**
   * @type {SlotsMap}
   */
  get slots() {
    return {
      ...super.slots,
      /**
       * The interactive element that can receive focus
       */
      input: () => document.createElement('input'),
      /**
       * As opposed to our parent (LionListbox), the end user doesn't interact with the
       * element that has [role=listbox] (in a combobox, it has no tabindex), but with
       * the text box (<input>) element.
       */
      listbox: super.slots.input,
    };
  }

  /**
   * Wrapper with combobox role for the text input that the end user controls the listbox with.
   * @type {HTMLElement}
   */
  get _comboboxNode() {
    return /** @type {HTMLElement} */ (
      /** @type {ShadowRoot} */ (this.shadowRoot).querySelector('[data-ref="combobox"]')
    );
  }

  /**
   * @override FormControlMixin
   * Will tell FormControlMixin that a11y wrt labels / descriptions / feedback
   * should be applied here.
   */
  get _inputNode() {
    return /** @type {HTMLInputElement} */ (this.querySelector('[slot=input]'));
  }

  /**
   * @type {HTMLElement | null}
   */
  get _selectionDisplayNode() {
    return this.querySelector('[slot="selection-display"]');
  }

  constructor() {
    super();
    /**
     * @desc When "list", will filter listbox suggestions based on textbox value.
     * When "both", an inline completion string will be added to the textbox as well.
     * @type {'list'|'both'|'none'}
     */
    this.autocomplete = 'both';
    /**
     * @desc When typing in the textbox, will by default be set on 'begin',
     * only matching the beginning part in suggestion list.
     * => 'a' will match 'apple' from ['apple', 'pear', 'citrus'].
     * When set to 'all', will match middle of the word as well
     * => 'a' will match 'apple' and 'pear'
     * @type {'begin'|'all'}
     */
    this.matchMode = 'all';

    this.__cboxInputValue = '';
    this.__prevCboxValueNonSelected = '';

    /** @type {EventListener} */
    this.__showOverlay = this.__showOverlay.bind(this);
    /** @type {EventListener} */
    this._textboxOnInput = this._textboxOnInput.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._selectionDisplayNode) {
      this._selectionDisplayNode.comboboxElement = this;
    }
  }

  /**
   * @param {import('lit-element').PropertyValues } changedProperties
   */
  updated(changedProperties) {
    super.updated(changedProperties);

    if (changedProperties.has('autocomplete')) {
      this._inputNode.setAttribute('aria-autocomplete', this.autocomplete);
    }
    if (changedProperties.has('disabled')) {
      this.setAttribute('aria-disabled', `${this.disabled}`); // create mixin if we need it in more places
    }
    if (
      changedProperties.has('__shouldAutocompleteNextUpdate') &&
      this.__shouldAutocompleteNextUpdate
    ) {
      // Only update list in render cycle
      this._handleAutocompletion({
        curValue: this.__cboxInputValue,
        prevValue: this.__prevCboxValueNonSelected,
      });
      this.__shouldAutocompleteNextUpdate = false;
    }

    if (this._selectionDisplayNode) {
      this._selectionDisplayNode.onComboboxElementUpdated(changedProperties);
    }
  }

  __setupCombobox() {
    this._comboboxNode.setAttribute('role', 'combobox');
    this._comboboxNode.setAttribute('aria-haspopup', 'listbox');
    this._comboboxNode.setAttribute('aria-expanded', 'false');
    this._comboboxNode.setAttribute('aria-owns', this._listboxNode.id);

    this._inputNode.setAttribute('aria-autocomplete', this.autocomplete);
    this._inputNode.setAttribute('aria-controls', this._listboxNode.id);
    this._inputNode.setAttribute('aria-labelledby', this._labelNode.id);

    this._inputNode.addEventListener('keydown', this._listboxOnKeyDown);
    this._inputNode.addEventListener('input', this._textboxOnInput);
  }

  __teardownCombobox() {
    this._inputNode.removeEventListener('keydown', this._listboxOnKeyDown);
    this._inputNode.removeEventListener('input', this._textboxOnInput);
  }

  /**
   * @param {Event} ev
   */
  _textboxOnInput(ev) {
    this.__cboxInputValue = /** @type {LionOption} */ (ev.target).value;
    // Schedules autocompletion of options
    this.__shouldAutocompleteNextUpdate = true;
  }

  /**
   * @param {MouseEvent} ev
   */
  _listboxOnClick(ev) {
    super._listboxOnClick(ev);
    this._inputNode.focus();
    this.__syncCheckedWithTextboxOnInteraction();
  }

  /**
   * @override
   */
  _setupListboxNode() {
    super._setupListboxNode();
    // Only the textbox should be focusable
    this._listboxNode.removeAttribute('tabindex');
  }

  /**
   * @overridable
   * @param {LionOption} option
   * @param {string} curValue current ._inputNode value
   */
  filterOptionCondition(option, curValue) {
    const idx = option.choiceValue.toLowerCase().indexOf(curValue.toLowerCase());
    if (this.matchMode === 'all') {
      return idx > -1; // matches part of word
    }
    return idx === 0; // matches beginning of value
  }

  /* eslint-disable no-param-reassign, class-methods-use-this */

  /**
   * @overridable
   * @param {LionOption & {__originalInnerHTML?:string}} option
   * @param {string} matchingString
   */
  _onFilterMatch(option, matchingString) {
    const { innerHTML } = option;
    option.__originalInnerHTML = innerHTML;
    option.innerHTML = innerHTML.replace(new RegExp(`(${matchingString})`, 'i'), `<b>$1</b>`);
    // Alternatively, an extension can add an animation here
    option.style.display = '';
  }

  /**
   * @overridable
   * @param {LionOption & {__originalInnerHTML?:string}} option
   * @param {string} [curValue]
   * @param {string} [prevValue]
   */
  // eslint-disable-next-line no-unused-vars
  _onFilterUnmatch(option, curValue, prevValue) {
    if (option.__originalInnerHTML) {
      option.innerHTML = option.__originalInnerHTML;
    }
    // Alternatively, an extension can add an animation here
    option.style.display = 'none';
    option.disabled = true;
  }

  /* eslint-enable no-param-reassign, class-methods-use-this */

  /**
   * @desc Matches visibility of listbox options against current ._inputNode contents
   * @param {object} config
   * @param {string} config.curValue current ._inputNode value
   * @param {string} config.prevValue previous ._inputNode value
   */
  _handleAutocompletion({ curValue, prevValue }) {
    if (this.autocomplete === 'none') {
      return;
    }

    /**
     * The filtered list of options that will match in this autocompletion cycle
     * @type {LionOption[]}
     */
    const visibleOptions = [];
    let hasAutoFilled = false;
    const userIsAddingChars = prevValue.length < curValue.length;

    /** @typedef {LionOption & { onFilterUnmatch?:function, onFilterMatch?:function }} OptionWithFilterFn */
    this.formElements.forEach((/** @type {OptionWithFilterFn} */ option, index) => {
      // [1]. Cleanup previous matching states
      if (option.onFilterUnmatch) {
        option.onFilterUnmatch(curValue, prevValue);
      } else {
        this._onFilterUnmatch(option, curValue, prevValue);
      }

      // [2]. If ._inputNode is empty, no filtering will be applied
      if (!curValue) {
        visibleOptions.push(option);
        return;
      }

      // [3]. Cleanup previous visibility and a11y states
      /* eslint-disable no-param-reassign */
      option.disabled = true; // makes it compatible with keyboard interaction methods
      option.removeAttribute('aria-posinset');
      option.removeAttribute('aria-setsize');
      /* eslint-enable no-param-reassign */

      // [4]. Add options that meet matching criteria
      const show = this.filterOptionCondition(option, curValue);
      if (show) {
        visibleOptions.push(option);
        if (option.onFilterMatch) {
          option.onFilterMatch(curValue);
        } else {
          this._onFilterMatch(option, curValue);
        }
      }

      // [5]. Synchronize ._inputNode value and active descendant with closest match
      const beginsWith = option.choiceValue.toLowerCase().indexOf(curValue.toLowerCase()) === 0;
      if (beginsWith && !hasAutoFilled && show && userIsAddingChars) {
        if (this.autocomplete === 'both') {
          this._inputNode.value = option.choiceValue;
          this._inputNode.selectionStart = this.__cboxInputValue.length;
          this._inputNode.selectionEnd = this._inputNode.value.length;
        }
        this.activeIndex = index;
        hasAutoFilled = true;
      }
    });

    // [6]. enable a11y, visibility and user interaction for visible options
    visibleOptions.forEach((option, idx) => {
      /* eslint-disable no-param-reassign */
      option.setAttribute('aria-posinset', `${idx + 1}`);
      option.setAttribute('aria-setsize', `${visibleOptions.length}`);
      option.disabled = false;
      /* eslint-enable no-param-reassign */
    });
    /** @type {number} */
    const { selectionStart } = this._inputNode;
    this.__prevCboxValueNonSelected = curValue.slice(0, selectionStart);

    if (this._overlayCtrl && this._overlayCtrl._popper) {
      this._overlayCtrl._popper.update();
    }
  }

  /**
   * @param {'disabled'|'modelValue'|'readOnly'} name
   * @param {unknown} oldValue
   */
  requestUpdateInternal(name, oldValue) {
    super.requestUpdateInternal(name, oldValue);
    if (name === 'disabled' || name === 'readOnly') {
      this.__setComboboxDisabledAndReadOnly();
    }
  }

  __setComboboxDisabledAndReadOnly() {
    if (this._comboboxNode) {
      this._comboboxNode.setAttribute('disabled', `${this.disabled}`);
      this._comboboxNode.setAttribute('readonly', `${this.readOnly}`);
    }
  }

  /**
   * @override FormControlMixin
   */
  // eslint-disable-next-line class-methods-use-this
  _inputGroupInputTemplate() {
    return html`
      <div class="input-group__input">
        <div class="combobox__input" data-ref="combobox">
          <slot name="selection-display"></slot>
          <slot name="input"></slot>
        </div>
      </div>
    `;
  }

  // eslint-disable-next-line class-methods-use-this
  _overlayListboxTemplate() {
    return html`
      <slot name="_overlay-shadow-outlet"></slot>
      <div id="overlay-content-node-wrapper" role="dialog">
        <slot name="listbox"></slot>
      </div>
      <slot id="options-outlet"></slot>
    `;
  }

  _groupTwoTemplate() {
    return html` ${super._groupTwoTemplate()} ${this._overlayListboxTemplate()}`;
  }

  /**
   * @override OverlayMixin
   */
  // eslint-disable-next-line class-methods-use-this
  _defineOverlayConfig() {
    return /** @type {OverlayConfig} */ ({
      ...withDropdownConfig(),
      elementToFocusAfterHide: undefined,
    });
  }

  _setupOverlayCtrl() {
    super._setupOverlayCtrl();
    this.__initFilterListbox();
    this.__setupCombobox();
  }

  __initFilterListbox() {
    this._handleAutocompletion({
      curValue: this.__cboxInputValue,
      prevValue: this.__prevCboxValueNonSelected,
    });
  }

  /**
   * @override Configures OverlayMixin
   */
  get _overlayInvokerNode() {
    return this._comboboxNode;
  }

  /**
   * @override Configures OverlayMixin
   */
  get _overlayContentNode() {
    return this._listboxNode;
  }

  get _listboxNode() {
    return /** @type {LionOptions} */ ((this._overlayCtrl && this._overlayCtrl.contentNode) ||
      Array.from(this.children).find(child => child.slot === 'listbox'));
  }

  /**
   * @param {Event} ev
   */
  __showOverlay(ev) {
    if (
      /** @type {KeyboardEvent} */ (ev).key === 'Tab' ||
      /** @type {KeyboardEvent} */ (ev).key === 'Esc' ||
      /** @type {KeyboardEvent} */ (ev).key === 'Enter' ||
      this.__blockListShow
    ) {
      return;
    }
    this.opened = true;
  }

  /**
   * @override OverlayMixin
   */
  _setupOpenCloseListeners() {
    super._setupOpenCloseListeners();
    this._overlayInvokerNode.addEventListener('keyup', this.__showOverlay);
  }

  /**
   * @override OverlayMixin
   */
  _teardownOpenCloseListeners() {
    super._teardownOpenCloseListeners();
    this._overlayInvokerNode.removeEventListener('keyup', this.__showOverlay);
  }

  /**
   * @param {Event & { target:LionOption }} ev
   */
  _onChildActiveChanged(ev) {
    super._onChildActiveChanged(ev);
    if (ev.target.active) {
      this._inputNode.setAttribute('aria-activedescendant', ev.target.id);
    }
  }

  /**
   * @param {KeyboardEvent} ev
   */
  _listboxOnKeyDown(ev) {
    super._listboxOnKeyDown(ev);
    const { key } = ev;
    switch (key) {
      case 'Escape':
        this.opened = false;
        this.__shouldAutocompleteNextUpdate = true;
        this._inputNode.value = '';
        this.__cboxInputValue = '';
        break;
      case 'Enter':
        this.__syncCheckedWithTextboxOnInteraction();
      /* no default */
    }
  }

  __syncCheckedWithTextboxOnInteraction() {
    if (!this.multipleChoice) {
      this._inputNode.value = this.formElements[/** @type {number} */ (this.checkedIndex)].value;
      this.opened = false;
    }
  }
}
