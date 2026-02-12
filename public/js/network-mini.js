/**
 * Network Mini - Compact network visualization for sidebar
 */

const NetworkMini = {
  svg: null,
  width: 300,
  height: 400,

  init() {
    this.svg = d3.select('#networkGraph');
    this.renderPlaceholder();
  },

  renderPlaceholder() {
    if (!this.svg) return;

    this.svg.selectAll('*').remove();
    
    this.svg.append('text')
      .attr('x', '50%')
      .attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .attr('font-size', '14px')
      .text('Network will appear after query');
  },

  render(data) {
    // TODO: Implement D3 network rendering
    console.log('Network data:', data);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  NetworkMini.init();
});

window.NetworkMini = NetworkMini;
