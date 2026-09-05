/*
 * Route-scoped adapter for the original second-account button.
 * It changes one existing control only; it does not add markup or styles.
 */
(function installRealmCompanySwitch() {
  'use strict';

  const REALM_ZERO = 0;
  let switching = false;

  function isRealmsPage() {
    return window.location.pathname.endsWith('/realms/');
  }

  function getSecondAccountButton() {
    const heading = Array.from(document.querySelectorAll('h3')).find(node =>
      (node.textContent || '').trim() === '本服第二账号 (账号2)'
    );
    if (!heading) return null;

    let card = heading.parentElement;
    for (let depth = 0; card && depth < 4; depth += 1, card = card.parentElement) {
      const buttons = Array.from(card.querySelectorAll('button'));
      const action = buttons.find(button => !(button.textContent || '').includes('前往地图'));
      if (buttons.length === 1 && action) return { button: action, card };
    }
    return null;
  }

  function getCardCompanyName(card) {
    const link = Array.from(card.querySelectorAll('a[href*="/company/"]'))[0];
    return link ? (link.textContent || '').trim() : '';
  }

  async function readTargetCompany(card) {
    const [authResponse, companiesResponse] = await Promise.all([
      fetch('/api/v3/companies/auth-data/', { credentials: 'same-origin' }),
      fetch('/api/v2/players/me/companies/', { credentials: 'same-origin' })
    ]);
    if (!authResponse.ok || !companiesResponse.ok) {
      throw new Error('无法读取当前登录公司的列表');
    }

    const auth = await authResponse.json();
    const companies = await companiesResponse.json();
    const activeId = Number(auth?.authCompany?.id);
    if (!Number.isSafeInteger(activeId) || activeId <= 0 || !Array.isArray(companies)) {
      throw new Error('当前登录状态无效');
    }

    const realmZeroCompanies = companies.filter(company =>
      Number.isSafeInteger(Number(company?.id)) &&
      Number(company.id) > 0 &&
      Number(company.realmId) === REALM_ZERO &&
      Number(company.id) !== activeId
    );
    const cardName = getCardCompanyName(card);
    const nameMatches = realmZeroCompanies.filter(company => company.company === cardName);

    if (nameMatches.length === 1) return nameMatches[0];
    if (nameMatches.length > 1 || realmZeroCompanies.length !== 1) {
      throw new Error('无法安全确定要切换的领域 0 公司');
    }
    return realmZeroCompanies[0];
  }

  async function switchCompany(button, card) {
    if (switching || !isRealmsPage()) return;
    switching = true;
    button.disabled = true;
    try {
      const target = await readTargetCompany(card);
      const targetId = Number(target.id);
      const response = await fetch(`/api/v2/companies/switch/${targetId}/`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => null);
      if (
        !response.ok ||
        result?.status !== 'redirect' ||
        Number(result.companyId) !== targetId ||
        Number(result.realmId) !== REALM_ZERO
      ) {
        throw new Error('公司切换未通过安全校验');
      }
      window.location.assign('/zh-cn/landscape/');
    } catch (error) {
      button.disabled = false;
      alert(error instanceof Error ? error.message : '公司切换失败');
    } finally {
      switching = false;
    }
  }

  document.addEventListener('click', event => {
    if (!isRealmsPage()) return;
    const target = getSecondAccountButton();
    if (!target || !target.button.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void switchCompany(target.button, target.card);
  }, true);
})();
