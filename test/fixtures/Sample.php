<?php
namespace App\Service;
use App\Models\User;
use App\Util\{Str, Arr};
require_once 'legacy.php';
interface Greeter { public function greet(): string; }
trait Loggable { public function log($m) {} }
abstract class UserService implements Greeter {
  use Loggable;
  private const MAX = 10;
  private $repo;
  public function __construct($repo) { $this->repo = $repo; }
  public function greet(): string { return 'hi'; }
  protected static function helper() {}
}
enum Status: string { case Active = 'a'; }
function topLevel($x) { return $x; }
const GLOBAL_C = 1;
